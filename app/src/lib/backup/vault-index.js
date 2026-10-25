// Where an empty device finds the books' vault (#406): on Aleph, as an
// aggregate under an address derived from a secret it already holds.
//
//   index P – one per passkey, from that passkey's PRF output. Holds the vault
//             record as it was when the slot was made. Only that passkey leads
//             there, and only it can sign there.
//   index M – one per books, from the vault's root. Holds the current vault
//             record and a pointer – the paying Aleph account the backups are
//             kept for – sealed under a key from the root. Any device with
//             the vault open keeps it current.
//
// An empty device with passkey B: B's PRF output → index P(B) → the vault,
// opened with B's slot → the root → index M → the current vault and the
// account → the backups (keeper.js `findBackups`).
//
// What is published is public and sealed: the vault record holds nothing
// secret in the clear (books-vault.js), the pointer is AES-GCM under a key
// from the root, and the addresses carry no name, no wallet and no label – the
// passkeys' names stay in this browser. After paperless-anywhere
// (pwa/src/lib/keys/index-keys.js), by the same author. Written only when the
// person adds a passkey or backs up, and never while the network is paused.

import { alephEndpoints } from './keeper.js';

/** The aggregate key the vault is kept under, at every index address. */
export const VAULT_INDEX_KEY = 'belege-vault';
/** The channel the index messages are sent on. */
export const VAULT_INDEX_CHANNEL = 'BELEGE-VAULT';

const PASSKEY_INDEX_INFO = 'belege/vault-index/passkey/v1';
const ROOT_INDEX_INFO = 'belege/vault-index/root/v1';
const POINTER_KEY_INFO = 'belege/vault-index/pointer/v1';
/** Bound to every sealed pointer: it opens as nothing else. */
const POINTER_PURPOSE = 'belege/vault-pointer/v1';

/** @param {Uint8Array} material @param {string} info @returns {Promise<Uint8Array>} */
async function hkdf(material, info) {
	const key = await crypto.subtle.importKey('raw', Uint8Array.from(material), 'HKDF', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new Uint8Array(0),
			info: new TextEncoder().encode(info)
		},
		key,
		256
	);
	return new Uint8Array(bits);
}

/**
 * A secp256k1 key from secret material: HKDF, and again with a counter in the
 * vanishing case that the bytes are no valid key.
 *
 * @param {Uint8Array} material
 * @param {string} info
 */
async function indexKey(material, info) {
	const { isAlephKey } = await import('./aleph-key.js');
	for (let n = 0; ; n++) {
		const key = await hkdf(material, n ? `${info}:${n}` : info);
		if (isAlephKey(key)) return key;
	}
}

/** Index P's key, from a passkey's PRF output. @param {Uint8Array} prfOutput */
export const passkeyIndexKey = (prfOutput) => indexKey(prfOutput, PASSKEY_INDEX_INFO);

/** Index M's key, from the vault's root. @param {Uint8Array} root */
export const rootIndexKey = (root) => indexKey(root, ROOT_INDEX_INFO);

/** @param {Uint8Array} root */
async function pointerKey(root) {
	return crypto.subtle.importKey(
		'raw',
		Uint8Array.from(await hkdf(root, POINTER_KEY_INFO)),
		'AES-GCM',
		false,
		['encrypt', 'decrypt']
	);
}

/** @param {Uint8Array} b */
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
/** @param {string} h */
const fromHex = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));

/**
 * The pointer, sealed under a key from the root: the account the backups are
 * kept for.
 *
 * @param {Uint8Array} root
 * @param {{ owner: string }} pointer
 */
export async function sealPointer(root, pointer) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(POINTER_PURPOSE) },
		await pointerKey(root),
		new TextEncoder().encode(JSON.stringify({ owner: pointer.owner }))
	);
	return { iv: toHex(iv), ciphertext: toHex(new Uint8Array(ciphertext)) };
}

/**
 * The pointer opened, or null when it does not open with this root.
 *
 * @param {Uint8Array} root
 * @param {{ iv: string, ciphertext: string } | null | undefined} sealed
 * @returns {Promise<{ owner: string } | null>}
 */
export async function openPointer(root, sealed) {
	if (!sealed || typeof sealed.iv !== 'string' || typeof sealed.ciphertext !== 'string')
		return null;
	try {
		const plain = await crypto.subtle.decrypt(
			{
				name: 'AES-GCM',
				iv: fromHex(sealed.iv),
				additionalData: new TextEncoder().encode(POINTER_PURPOSE)
			},
			await pointerKey(root),
			fromHex(sealed.ciphertext)
		);
		const parsed = JSON.parse(new TextDecoder().decode(plain));
		return typeof parsed?.owner === 'string' ? { owner: parsed.owner } : null;
	} catch {
		return null;
	}
}

/** @param {string} text @returns {Promise<string>} */
async function sha256Hex(text) {
	return toHex(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
	);
}

/**
 * Publish `content` at the address of `key`: an AGGREGATE message on Aleph,
 * signed by that key (`personal_sign`), for itself.
 *
 * @param {object} params
 * @param {Uint8Array} params.key from `passkeyIndexKey` or `rootIndexKey`
 * @param {Record<string, any>} params.content
 * @param {import('./keeper.js').AlephEndpoints} [params.endpoints]
 * @param {typeof fetch} [params.fetch]
 * @param {() => number} [params.now] seconds
 * @returns {Promise<{ address: string, itemHash: string }>}
 */
export async function publishIndex({
	key,
	content,
	endpoints = alephEndpoints(),
	fetch: f = fetch,
	now = () => Date.now() / 1000
}) {
	const { alephAddressOf, alephSign } = await import('./aleph-signer.js');
	const address = alephAddressOf(key);
	const time = now();
	const item_content = JSON.stringify({ address, key: VAULT_INDEX_KEY, content, time });
	const unsigned = {
		sender: address,
		chain: 'ETH',
		type: 'AGGREGATE',
		item_hash: await sha256Hex(item_content),
		item_type: 'inline',
		item_content,
		time,
		channel: VAULT_INDEX_CHANNEL
	};
	const signature = alephSign(
		key,
		[unsigned.chain, unsigned.sender, unsigned.type, unsigned.item_hash].join('\n')
	);
	const response = await f(`${endpoints.apiHost}/api/v0/messages`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ message: { ...unsigned, signature }, sync: true })
	});
	if (!response.ok && response.status !== 202) {
		throw new Error(`Aleph did not take the vault index: ${response.status}`);
	}
	return { address, itemHash: unsigned.item_hash };
}

/**
 * What is published at the address of `key`, or null.
 *
 * @param {object} params
 * @param {Uint8Array} params.key
 * @param {import('./keeper.js').AlephEndpoints} [params.endpoints]
 * @param {typeof fetch} [params.fetch]
 * @returns {Promise<Record<string, any> | null>}
 */
export async function readIndex({ key, endpoints = alephEndpoints(), fetch: f = fetch }) {
	const { alephAddressOf } = await import('./aleph-signer.js');
	const address = alephAddressOf(key);
	const response = await f(
		`${endpoints.apiHost}/api/v0/aggregates/${address}.json?keys=${VAULT_INDEX_KEY}`
	);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Aleph did not answer: ${response.status}`);
	const body = /** @type {any} */ (await response.json());
	const content = body?.data?.[VAULT_INDEX_KEY];
	return content && typeof content === 'object' ? content : null;
}

/**
 * The books' vault as index P of this passkey holds it, for an empty device;
 * null when there is none.
 *
 * @param {{ prfOutput: Uint8Array, endpoints?: import('./keeper.js').AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<import('../books-vault.js').VaultRecord | null>}
 */
export async function findVaultOnAleph({ prfOutput, endpoints, fetch: f }) {
	const content = await readIndex({
		key: await passkeyIndexKey(prfOutput),
		...(endpoints ? { endpoints } : {}),
		...(f ? { fetch: f } : {})
	});
	return content?.vault ? { vault: content.vault, slots: [], removed: [] } : null;
}

/**
 * Index M: the current vault record and the pointer, opened; null when there is none.
 *
 * @param {{ root: Uint8Array, endpoints?: import('./keeper.js').AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<{ vault: any, pointer: { owner: string } | null } | null>}
 */
export async function readRootIndex({ root, endpoints, fetch: f }) {
	const content = await readIndex({
		key: await rootIndexKey(root),
		...(endpoints ? { endpoints } : {}),
		...(f ? { fetch: f } : {})
	});
	if (!content?.vault) return null;
	return { vault: content.vault, pointer: await openPointer(root, content.pointer) };
}

/**
 * Publish the vault: at index M with the pointer (when the paying account is
 * known), and at index P of each passkey whose index key is at hand.
 *
 * @param {object} params
 * @param {Uint8Array} params.root
 * @param {any} params.vault the current vault record
 * @param {Uint8Array[]} params.passkeyKeys from `passkeyIndexKey`
 * @param {string | null} [params.owner] the paying Aleph account
 * @param {import('./keeper.js').AlephEndpoints} [params.endpoints]
 * @param {typeof fetch} [params.fetch]
 */
export async function publishVault({ root, vault, passkeyKeys, owner, endpoints, fetch: f }) {
	const options = { ...(endpoints ? { endpoints } : {}), ...(f ? { fetch: f } : {}) };
	await publishIndex({
		key: await rootIndexKey(root),
		content: { vault, ...(owner ? { pointer: await sealPointer(root, { owner }) } : {}) },
		...options
	});
	for (const key of passkeyKeys) await publishIndex({ key, content: { vault }, ...options });
}
