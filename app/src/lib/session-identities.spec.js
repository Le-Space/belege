import { describe, it, expect, afterAll } from 'vitest';
import { createHeliaLight } from 'helia';
import { withLibp2p } from '@helia/libp2p';
import * as dagCbor from '@ipld/dag-cbor';
import { deriveSigningKeyBytes } from '@le-space/orbitdb-identity-provider-webauthn-did';
import { isSessionKeystore } from '@le-space/orbitdb-identity-provider-webauthn-did/keystore';

import { createOfflineLibp2p } from './network.js';
import {
	LEGACY_KEYSTORE_DATABASE,
	createSessionIdentities,
	forgetLegacyKeystore
} from './session-identities.js';

const did = 'did:key:zDnaeSessionIdentitiesSpec';
const prfOutput = new Uint8Array(32).fill(7);

/** @type {any[]} */
const started = [];
async function helia() {
	const node = await withLibp2p(
		createHeliaLight({ codecs: [dagCbor] }),
		await createOfflineLibp2p()
	).start();
	started.push(node);
	return node;
}

afterAll(async () => {
	await Promise.all(started.map((node) => node.stop()));
});

describe('createSessionIdentities', () => {
	it('keeps the signing key in a keystore that lives in memory only', async () => {
		const signingKey = await deriveSigningKeyBytes(prfOutput, did);
		const identities = await createSessionIdentities(await helia(), { did, signingKey });

		expect(isSessionKeystore(identities.keystore)).toBe(true);
		const key = await identities.keystore.getKey(did);
		expect(key?.raw).toEqual(signingKey);
	});

	it('forgets the key between sessions, and a session derives the same one again', async () => {
		const signingKey = await deriveSigningKeyBytes(prfOutput, did);
		const one = await createSessionIdentities(await helia(), { did, signingKey });
		const other = await createSessionIdentities(await helia(), { did: `${did}2`, signingKey });

		// Nothing is shared: each session has only what it was given.
		expect(await other.keystore.getKey(did)).toBeFalsy();
		expect(await deriveSigningKeyBytes(prfOutput, did)).toEqual(signingKey);
		expect((await one.keystore.getKey(did))?.raw).toEqual(signingKey);
	});

	it('refuses a missing DID or a key of the wrong size', async () => {
		const node = await helia();
		await expect(
			createSessionIdentities(node, { did: '', signingKey: new Uint8Array(32) })
		).rejects.toThrow(/DID/);
		await expect(
			createSessionIdentities(node, { did, signingKey: new Uint8Array(16) })
		).rejects.toThrow(/32-byte/);
	});
});

/** A fake IDBFactory whose delete request ends the way `outcome` says. */
function fakeIndexedDB(/** @type {'success' | 'error' | 'blocked' | 'throw'} */ outcome) {
	/** @type {string[]} */
	const deleted = [];
	return {
		deleted,
		deleteDatabase(/** @type {string} */ name) {
			if (outcome === 'throw') throw new Error('SecurityError');
			deleted.push(name);
			/** @type {any} */
			const request = {};
			queueMicrotask(() => request[`on${outcome}`]?.());
			return request;
		}
	};
}

describe('forgetLegacyKeystore', () => {
	it('deletes the keystore database PR #1 wrote', async () => {
		const idb = fakeIndexedDB('success');
		expect(await forgetLegacyKeystore(/** @type {any} */ (idb))).toBe('deleted');
		expect(idb.deleted).toEqual(['level-js-belege/orbitdb/keystore']);
		expect(LEGACY_KEYSTORE_DATABASE).toBe('level-js-belege/orbitdb/keystore');
	});

	it('never keeps the books shut', async () => {
		expect(await forgetLegacyKeystore(/** @type {any} */ (fakeIndexedDB('error')))).toBe('failed');
		expect(await forgetLegacyKeystore(/** @type {any} */ (fakeIndexedDB('blocked')))).toBe(
			'blocked'
		);
		expect(await forgetLegacyKeystore(/** @type {any} */ (fakeIndexedDB('throw')))).toBe('failed');
		expect(await forgetLegacyKeystore(undefined)).toBe('unavailable');
	});
});
