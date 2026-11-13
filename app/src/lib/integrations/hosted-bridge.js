// The hosted bridge (#583–#585): the bridge in an Aleph confidential VM
// (AMD SEV-SNP), attested and unlocked from this browser, and paired in the
// same step.
//
// The VM belongs to the books' own Aleph key (backup/keeper.js), the account
// Le Space Credits top up (paperless-anywhere#7, pattern B). So this browser
// signs the unlock itself, and no secret passes through Le Space:
//
//   1. the INSTANCE is the books' key's, boots the published image (its
//      STORE) and pins the measurement computed here from Aleph's published
//      SEV-SNP runtime and the owner's address (`releaseCheck`);
//   2. the guest proves that measurement in the RA-TLS handshake, through an
//      attest relay's /attest, and a fresh report proves it is live
//      (@le-space/attest-wasm, relay-button's code);
//   3. only then the owner-signed injection: the disk passphrase and what the
//      bridge starts with – its own peer key (made here, so its peer id is
//      known before it runs), the bridge's key of the books (database-keys.js
//      `bridgeAuthKeyOf`) and the books' devices. It starts armed and paired;
//      no invitation, no code.
//
// The same check runs in the live test (bridge/rootfs/test/release.mjs):
// change both together.

import { pinsOf, unlockInstance } from '@le-space/attest-wasm/instance';

/**
 * The bridge image every hosted bridge boots: the STORE of the "Bridge image"
 * workflow's release (bridge-image.json), encrypted, published on Aleph. A new
 * image is a new release of the app, with this hash changed.
 */
export const HOSTED_IMAGE = '4ee0ab57bb64da3b516b3ed6494275356119089241ef6ab533d3ab60ae08a526';

/** The sealed settings record: which VM, its name, the bridge's own peer key, when it was attested. */
export const HOSTED_SETTING = 'bridge/hosted';

/** In E2E builds only: a fake Aleph's attest relay, and the measurement the fake agent reports. */
export const E2E_ATTEST_URL_KEY = 'belege.e2e.attestUrl';
export const E2E_HOSTED_PINS_KEY = 'belege.e2e.hostedPins';

const HASH = /^[0-9a-f]{64}$/;

/** @param {unknown} value */
export const isInstanceHash = (value) => typeof value === 'string' && HASH.test(value.trim());

/**
 * Throws, naming what differs, unless the INSTANCE boots `image` for `owner`
 * and pins exactly the measurements of `published`. Whatever fails, no
 * secret goes out.
 *
 * @param {{ instance: any, published: any, image: string, owner: string }} options
 *   `instance` is the INSTANCE message's content
 * @returns {{ expectedMeasurements: string[], expectedPolicy: number | undefined }} the pins to attest with
 */
export function releaseCheck({ instance, published, image, owner }) {
	if (!HASH.test(image ?? '')) throw new Error('the published image is not a STORE hash');
	const refuse = (/** @type {string} */ why) => {
		throw new Error(`${why}: no secret goes out`);
	};
	if (String(instance?.address ?? '').toLowerCase() !== String(owner ?? '').toLowerCase()) {
		refuse('the INSTANCE is not the owner’s');
	}
	if (instance?.rootfs?.parent?.ref !== image) {
		refuse('the INSTANCE boots another image than the published one');
	}
	const ours = pinsOf(published);
	/** @type {{ expectedMeasurements: string[], expectedPolicy: number | undefined } | undefined} */
	let theirs;
	try {
		theirs = pinsOf(instance?.environment?.trusted_execution);
	} catch {
		refuse('the INSTANCE pins no SEV-SNP measurement');
	}
	const same =
		ours.expectedPolicy === theirs?.expectedPolicy &&
		ours.expectedMeasurements.length === theirs?.expectedMeasurements.length &&
		ours.expectedMeasurements.every((m) => theirs?.expectedMeasurements.includes(m));
	if (!same) refuse('the INSTANCE pins a measurement other than the published one');
	return ours;
}

/**
 * The INSTANCE as Aleph holds it: processed, and the node it was placed on.
 *
 * @param {string} hash
 * @param {{ apiHost: string, fetch?: typeof fetch }} options
 * @returns {Promise<{ content: any, crn: string, vcpus: number }>}
 */
export async function fetchInstance(hash, { apiHost, fetch: f = globalThis.fetch }) {
	if (!isInstanceHash(hash)) throw new Error('not an INSTANCE hash');
	const response = await f(`${apiHost}/api/v0/messages/${hash.trim()}`, { cache: 'no-cache' });
	if (!response.ok) throw new Error(`Aleph answered ${response.status} for the INSTANCE`);
	const body = await response.json();
	const message = body?.message ?? body;
	if (body?.status !== 'processed' || message?.type !== 'INSTANCE') {
		throw new Error('Aleph holds no running INSTANCE under this hash');
	}
	const content = message.content;
	const crn = content?.requirements?.node?.node_hash;
	if (!isInstanceHash(crn)) throw new Error('the INSTANCE names no node');
	const vcpus = Number(content?.resources?.vcpus);
	return { content, crn, vcpus: Number.isSafeInteger(vcpus) && vcpus > 0 ? vcpus : 2 };
}

/**
 * Where to attest: the /attest of a relay the books use (a TLS WebSocket by
 * name), or, in an E2E build, the fake one the test names.
 *
 * @param {string[]} relays multiaddrs
 * @returns {string | null} `wss://<host>/attest`
 */
export function attestUrlOf(relays) {
	if (import.meta.env.VITE_E2E === 'true') {
		const e2e = globalThis.localStorage?.getItem(E2E_ATTEST_URL_KEY);
		if (e2e) return e2e;
	}
	for (const relay of relays ?? []) {
		const m = /^\/dns4\/([a-z0-9.-]+)\/tcp\/443\/tls\/ws\//.exec(relay);
		if (m) return `wss://${m[1]}/attest`;
	}
	return null;
}

/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** @param {Uint8Array} bytes */
const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));

/**
 * What the bridge starts with, as the image reads it (bridge/rootfs/files/
 * belege-bridge-run): the HTTPS name, its key of the books, its own peer key,
 * and a config naming the relays and the books' devices.
 *
 * @param {{ host: string, authKey: Uint8Array, peerKey: Uint8Array, relays: string[], devices: string[] }} p
 * @returns {Record<string, string>}
 */
export function hostedSecrets({ host, authKey, peerKey, relays, devices }) {
	return {
		https_hostname: host,
		bridge_auth: toHex(authKey),
		bridge_peer_key: toBase64(peerKey),
		bridge_config: JSON.stringify({
			node: {
				relays: relays.slice(0, 16),
				devices: [...new Set(devices)].slice(0, 64)
			}
		})
	};
}

/**
 * `releaseCheck`, then relay-button's `unlockInstance` with the pins computed
 * here (`published`), so the guest's report is held against them and not
 * against what the message says.
 *
 * @param {{ instance: any, published: any, image: string, owner: string } & Record<string, any>} options
 *   the rest goes to `unlockInstance` (wasm, relayUrl, crnHash, instanceItemHash, passphrase, secrets, sign, …)
 * @returns {Promise<{ injected: string[], measurement: string, policy: string }>}
 */
export async function unlockHosted({ instance, published, image, owner, ...rest }) {
	releaseCheck({ instance, published, image, owner });
	return unlockInstance(/** @type {any} */ ({ ...rest, trustedExecution: published }));
}
