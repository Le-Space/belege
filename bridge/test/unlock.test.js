// Secrets only after attestation (#584): a VM with a changed image gets no
// secret. A stand-in for the guest's attestation agent (RA-TLS certificate,
// fresh reports, the owner-checked injection; after relay-button's
// attest-wasm tests) records every secret it receives; the unlock is the
// owner's (rootfs/test/release.mjs, the code the live run uses).
//
// The AMD signature chain is stubbed (relay-button's attest-wasm tests cover
// it); the RA-TLS handshake, the measurement check, the key binding and the
// fresh report are the real WASM code.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import * as wasm from '@le-space/attest-wasm/pkg/relay_button_attest.js';

import { addressOf, newBackupKey, personalSign } from '../src/aleph-backup.js';
import { releaseCheck, unlockHosted } from '../rootfs/test/release.mjs';
import {
	FAKE_POLICY as POLICY,
	fakeVerify as verify,
	startFakeAttestAgent
} from './support/fake-attest-agent.js';

const require = createRequire(import.meta.url);
wasm.initSync({
	module: await readFile(require.resolve('@le-space/attest-wasm/pkg/relay_button_attest_bg.wasm'))
});

const IMAGE = 'c'.repeat(64);
const OTHER_IMAGE = 'd'.repeat(64);
const PUBLISHED = '11'.repeat(48);
const CHANGED = '22'.repeat(48);
const CRN = 'e'.repeat(64);
const VM = 'a'.repeat(64);

const ownerKey = newBackupKey();
const owner = addressOf(ownerKey);
const sign = async (/** @type {string} */ payload) => personalSign(ownerKey, payload);

/** Aleph's SEV-SNP runtime for this owner, as the unlocking side computes it. */
const published = {
	policy: POLICY,
	measurements: [{ platform: 'sev_snp', registers: { launch: PUBLISHED }, vcpu_type: 'EPYC-v4' }]
};
/** The INSTANCE message's content, by default the published image for the owner. */
const instance = (/** @type {Record<string, any>} */ over = {}) => ({
	address: owner,
	rootfs: { parent: { ref: IMAGE, use_latest: true }, persistence: 'host', size_mib: 10240 },
	environment: { trusted_execution: published },
	...over
});

const SECRETS = { imap: 'not-a-real-password', bridge_config: '{}' };

/** The owner's unlock of `vm` (an agent), for `content` (the INSTANCE). */
const unlock = (/** @type {any} */ vm, /** @type {any} */ content) =>
	unlockHosted({
		instance: content,
		published,
		image: IMAGE,
		owner,
		wasm,
		relayUrl: 'wss://relay.example/attest',
		crnHash: CRN,
		instanceItemHash: VM,
		passphrase: 'not-the-real-passphrase',
		secrets: SECRETS,
		sign,
		verify,
		transport: vm.transport,
		sleep: async () => assert.fail('a verdict is not retried'),
		attempts: 1
	});

/** @type {any[]} */
const guests = [];
const started = async (/** @type {string} */ measurement) => {
	const g = await startFakeAttestAgent({ measurement, owner });
	guests.push(g);
	return g;
};
after(() => Promise.all(guests.map((g) => g.close())));

test('the published image on the published runtime gets its secrets, with the passphrase', async () => {
	const vm = await started(PUBLISHED);
	const result = await unlock(vm, instance());
	assert.equal(result.measurement, PUBLISHED);
	assert.deepEqual(Object.keys(vm.received).sort(), ['bridge_config', 'imap', 'luks_passphrase']);
});

test('a changed runtime (kernel, initrd, firmware) ends the handshake: no secret', async () => {
	const vm = await started(CHANGED);
	await assert.rejects(unlock(vm, instance()), /measurement/);
	assert.equal(vm.connections(), 1);
	assert.deepEqual(vm.received, {});
});

test('an INSTANCE that boots another image gets no secret, and is not even dialled', async () => {
	const vm = await started(PUBLISHED);
	await assert.rejects(
		unlock(vm, instance({ rootfs: { parent: { ref: OTHER_IMAGE, use_latest: true } } })),
		/another image than the published one: no secret goes out/
	);
	await assert.rejects(
		unlock(vm, instance({ rootfs: undefined })),
		/another image than the published one/
	);
	assert.equal(vm.connections(), 0);
	assert.deepEqual(vm.received, {});
});

test('an INSTANCE that pins another measurement, or none, gets no secret', async () => {
	const vm = await started(CHANGED);
	const pinning = (/** @type {any} */ tee) => instance({ environment: { trusted_execution: tee } });
	await assert.rejects(
		unlock(
			vm,
			pinning({
				...published,
				measurements: [{ platform: 'sev_snp', registers: { launch: CHANGED } }]
			})
		),
		/a measurement other than the published one/
	);
	await assert.rejects(
		unlock(vm, pinning({ ...published, policy: 0x10000 })),
		/a measurement other than the published one/
	);
	await assert.rejects(unlock(vm, pinning(undefined)), /pins no SEV-SNP measurement/);
	assert.equal(vm.connections(), 0);
	assert.deepEqual(vm.received, {});
});

test('an INSTANCE of someone else gets no secret', async () => {
	const vm = await started(PUBLISHED);
	await assert.rejects(
		unlock(vm, instance({ address: addressOf(newBackupKey()) })),
		/not paid by the owner or its payer/
	);
	assert.equal(vm.connections(), 0);
	assert.deepEqual(vm.received, {});
});

test('releaseCheck returns the pins to attest with', () => {
	assert.deepEqual(releaseCheck({ instance: instance(), published, image: IMAGE, owner }), {
		expectedMeasurements: [PUBLISHED],
		expectedPolicy: POLICY
	});
	assert.throws(
		() => releaseCheck({ instance: instance(), published, image: 'latest', owner }),
		/not a STORE hash/
	);
});

// An image of its own per set of books (#777): the same plain image, sealed
// again with another passphrase, is another STORE. The launch measurement
// covers the runtime and the owner, not the rootfs, so it stays the one the
// unlocking side computes; only the image the INSTANCE names differs.
const OWN_IMAGE = 'f'.repeat(64);
const ownInstance = (/** @type {Record<string, any>} */ over = {}) =>
	instance({
		rootfs: { parent: { ref: OWN_IMAGE, use_latest: true }, persistence: 'host', size_mib: 10240 },
		...over
	});
/** The owner's unlock of a VM expected to boot `image`, with that image's passphrase. */
const unlockImage = (
	/** @type {any} */ vm,
	/** @type {any} */ content,
	/** @type {string} */ image,
	/** @type {string} */ passphrase
) =>
	unlockHosted({
		instance: content,
		published,
		image,
		owner,
		wasm,
		relayUrl: 'wss://relay.example/attest',
		crnHash: CRN,
		instanceItemHash: VM,
		passphrase,
		secrets: SECRETS,
		sign,
		verify,
		transport: vm.transport,
		sleep: async () => assert.fail('a verdict is not retried'),
		attempts: 1
	});

test('a VM from a re-sealed image shows the same measurement and pins as one from the shared image', async () => {
	const shared = instance();
	const own = ownInstance();
	// What the INSTANCE pins is the same block; only the rootfs' STORE differs.
	assert.deepEqual(own.environment.trusted_execution, shared.environment.trusted_execution);
	assert.deepEqual(
		{ ...own, rootfs: { ...own.rootfs, parent: { ...own.rootfs.parent, ref: IMAGE } } },
		shared
	);
	assert.deepEqual(
		releaseCheck({ instance: own, published, image: OWN_IMAGE, owner }),
		releaseCheck({ instance: shared, published, image: IMAGE, owner })
	);

	// The guest proves the measurement computed for the shared image's VM, and
	// gets the passphrase of its own image.
	const vm = await started(PUBLISHED);
	const result = await unlockImage(vm, own, OWN_IMAGE, 'made-up-own-passphrase');
	assert.equal(result.measurement, PUBLISHED);
	assert.equal(vm.received.luks_passphrase, 'made-up-own-passphrase');
	assert.deepEqual(Object.keys(vm.received).sort(), ['bridge_config', 'imap', 'luks_passphrase']);
});

test('a re-sealed image on a changed runtime gets no secret', async () => {
	const vm = await started(CHANGED);
	await assert.rejects(
		unlockImage(vm, ownInstance(), OWN_IMAGE, 'made-up-own-passphrase'),
		/measurement/
	);
	assert.deepEqual(vm.received, {});
});

test('the passphrase of one image never goes to a VM that boots the other', async () => {
	const vm = await started(PUBLISHED);
	// The books expect their own image; the INSTANCE names the shared one.
	await assert.rejects(
		unlockImage(vm, instance(), OWN_IMAGE, 'made-up-own-passphrase'),
		/another image than the published one: no secret goes out/
	);
	// The books expect the shared image; the INSTANCE names a re-sealed one.
	await assert.rejects(
		unlockImage(vm, ownInstance(), IMAGE, 'not-the-real-passphrase'),
		/another image than the published one: no secret goes out/
	);
	assert.equal(vm.connections(), 0);
	assert.deepEqual(vm.received, {});
});
