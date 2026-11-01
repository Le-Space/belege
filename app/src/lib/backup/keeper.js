// Keeping a backup on Aleph with this browser's own key (issue #77; the plan
// Belege shares with Le-Space/invoice#28).
//
// The bridge's account pays (`pnpm setup:aleph`). It lets the browser's key
// send STORE messages on BELEGE-BACKUP, once:
//
//   pnpm setup:aleph -- --authorize <address> --channel BELEGE-BACKUP
//
// From then on the browser keeps a backup alone: it uploads the sealed file to
// Aleph's IPFS host, signs the STORE for the account (`content.address`), paid
// in credits, and follows it until Aleph has decided. The bridge does not
// have to run. Until the grant, the bridge signs, as before.
//
// The key is made in this browser and kept in the sealed settings, as the
// bridge token is: it goes with the books to own devices and into every
// backup. Its address is public; it is what the grant names. A stolen key
// could only have Aleph keep files on that one channel at the account's cost.
// It opens no backup (they are sealed with the passkey's key) and moves no
// funds, and `pnpm setup:aleph -- --revoke <address>` takes the grant back.
//
// The backups are found by the paying account: Aleph lists the STORE messages
// whose `content.address` it is (`owners=`), whoever sent them, the bridge or
// this key (measured 2026-10-03). An empty browser needs that address, or a
// backup's CID; a paired bridge names the address.
//
// After Le-Space/invoice (app/src/lib/backup.js), by the same author. The
// storage bridge and the curve code are loaded only here, when they are used.

import { getSetting, setSetting } from '../store/settings.js';
import { isAlephKey, newAlephKey } from './aleph-key.js';
import { ingestUrlOf } from './history.js';

/** The Aleph channel Belege's backups are kept on, and found by. */
export const BACKUP_CHANNEL = 'BELEGE-BACKUP';
/** The settings record with the paying account's address. */
export const OWNER_SETTING = 'backup/owner';
/** The settings record with this browser's Aleph key, as hex. */
export const KEY_SETTING = 'backup/aleph-key';
/** In E2E builds only: where a fake Aleph runs, set by the test. */
export const E2E_ALEPH_URL_KEY = 'belege.e2e.alephUrl';

const ALEPH = Object.freeze({
	ingestUrl: 'https://ipfs.aleph.cloud/api/v0/add',
	apiHost: 'https://api2.aleph.im',
	gateways: ['https://ipfs.aleph.cloud/ipfs']
});

/** @typedef {{ ingestUrl: string, apiHost: string, gateways: string[] }} AlephEndpoints */

/**
 * Where Aleph is: its own hosts, or the ones a paired bridge names (a fake on
 * 127.0.0.1 in tests). Only https, or http on 127.0.0.1, is taken.
 *
 * @param {{ ingestUrl?: string, apiHost?: string, gateways?: string[] } | null} [named]
 * @returns {AlephEndpoints}
 */
export function alephEndpoints(named) {
	/** @type {AlephEndpoints} */
	let own = ALEPH;
	// Written inline so every other build drops it.
	if (import.meta.env.VITE_E2E === 'true') {
		const base = globalThis.localStorage?.getItem(E2E_ALEPH_URL_KEY);
		if (base) own = { ingestUrl: `${base}/api/v0/add`, apiHost: base, gateways: [`${base}/ipfs`] };
	}
	const ingestUrl = ingestUrlOf(named?.ingestUrl);
	const apiHost = ingestUrlOf(named?.apiHost);
	const gateways = /** @type {string[]} */ (
		(named?.gateways ?? []).map(ingestUrlOf).filter(Boolean)
	);
	return {
		ingestUrl: ingestUrl ?? own.ingestUrl,
		apiHost: apiHost ? apiHost.replace(/\/+$/, '') : own.apiHost,
		gateways: gateways.length ? gateways : own.gateways
	};
}

/** @param {unknown} value */
export const isAddress = (value) =>
	typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.trim());

/** @param {Uint8Array} bytes */
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** @param {string} hex */
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/**
 * The paying account's address, as kept in the sealed settings.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @returns {Promise<string | null>}
 */
export async function loadOwner(settings) {
	const value = await getSetting(settings, OWNER_SETTING);
	return isAddress(value) ? value : null;
}

/**
 * Keep the paying account's address, in EIP-55 form: Aleph keys accounts by it.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @param {string} address
 * @returns {Promise<string>} the address as kept
 */
export async function saveOwner(settings, address) {
	if (!isAddress(address)) throw new Error('Not an address: 0x and 40 hex digits.');
	const { toChecksumAddress } = await import('./aleph-signer.js');
	const owner = toChecksumAddress(address.trim());
	await setSetting(settings, OWNER_SETTING, owner);
	return owner;
}

/**
 * This browser's Aleph key: the one in the sealed settings, or a new one, kept there.
 *
 * The first key made for these books wins. A browser that made one before
 * its books came back from a backup, or before an own device synced in, finds
 * two records; it takes the older, which the account may already allow.
 *
 * @param {import('../store/repository.js').Collection} settings
 * @returns {Promise<Uint8Array>}
 */
export async function ensureBackupKey(settings) {
	// Newest first, as the collection lists them (by ULID).
	const records = await settings.list({ where: (r) => r.key === KEY_SETTING });
	for (const { value } of [...records].reverse()) {
		if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) continue;
		const key = fromHex(value);
		if (isAlephKey(key)) return key;
	}
	const key = newAlephKey();
	await settings.put({ key: KEY_SETTING, value: toHex(key) });
	return key;
}

/** The key's address: what the grant names. @param {Uint8Array} key */
export async function backupAddressOf(key) {
	const { alephAddressOf } = await import('./aleph-signer.js');
	return alephAddressOf(key);
}

/**
 * Has the paying account let this key send STORE on BELEGE-BACKUP? Read from
 * its `security` aggregate on Aleph, which anyone may read.
 *
 * @param {{ owner: string, address: string, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<boolean>}
 */
export async function isGranted({ owner, address, endpoints = alephEndpoints(), fetch: f }) {
	const { createAlephAuthorizer } = await import(
		'@le-space/orbitdb-storage-bridge/backends/aleph-pin'
	);
	const authorizer = createAlephAuthorizer({
		owner,
		// Only read here; the account's key is the bridge's, never this page's.
		sign: async () => {
			throw new Error('reading only');
		},
		apiHost: endpoints.apiHost,
		...(f ? { fetch: f } : {})
	});
	const same = (/** @type {unknown} */ a, /** @type {unknown} */ b) =>
		String(a).toLowerCase() === String(b).toLowerCase();
	return (await authorizer.read()).some(
		(grant) =>
			same(grant.address, address) &&
			(!grant.types?.length || grant.types.includes('STORE')) &&
			(!grant.channels?.length || grant.channels.includes(BACKUP_CHANNEL))
	);
}

/**
 * The paying account's credits, or null when Aleph does not say.
 *
 * @param {{ owner: string, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<number | null>}
 */
export async function creditsOf({ owner, endpoints = alephEndpoints(), fetch: f = fetch }) {
	const response = await f(`${endpoints.apiHost}/api/v0/addresses/${owner}/balance`).catch(
		() => null
	);
	if (!response?.ok) return null;
	const body = await response.json().catch(() => ({}));
	return Number.isFinite(body?.credit_balance) ? body.credit_balance : null;
}

/** Aleph did not keep a backup; `reason` says why, when Aleph said. */
export class BackupRefusedError extends Error {
	/** @param {'credits' | 'rejected'} kind @param {Record<string, unknown>} reason */
	constructor(kind, reason) {
		super(
			kind === 'credits'
				? 'Aleph wants more credits for a day of this backup.'
				: 'Aleph did not keep the backup.'
		);
		this.name = 'BackupRefusedError';
		this.kind = kind;
		this.reason = reason;
	}
}

/**
 * The pin Aleph takes beside an upload (storage bridge `createAlephBackend`,
 * `putBlob`): the STORE message signed with this browser's key for the
 * paying account, which Aleph's API node then keeps in the same call as the
 * upload. Also what `keepWithKey` sends on its own.
 *
 * @param {{ owner: string, key: Uint8Array, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 */
export async function backupPin({ owner, key, endpoints = alephEndpoints(), fetch: f }) {
	const [{ createAlephPin }, { alephAddressOf, alephSign }] = await Promise.all([
		import('@le-space/orbitdb-storage-bridge/backends/aleph-pin'),
		import('./aleph-signer.js')
	]);
	return createAlephPin({
		sender: alephAddressOf(key),
		owner,
		sign: async (_address, message) => alephSign(key, message),
		apiHost: endpoints.apiHost,
		channel: BACKUP_CHANNEL,
		...(f ? { fetch: f } : {})
	});
}

/**
 * Aleph's final word on a STORE it was sent: followed while pending; a
 * refusal thrown with its amounts.
 *
 * @param {{ itemHash: string, status: string }} sent
 * @param {{ endpoints?: AlephEndpoints, fetch?: typeof fetch, settle?: { timeout?: number, interval?: number } }} [options]
 * @returns {Promise<{ itemHash: string, status: string }>}
 * @throws {BackupRefusedError} when Aleph refuses to keep it
 */
export async function settleKept(
	sent,
	{ endpoints = alephEndpoints(), fetch: f, settle = {} } = {}
) {
	const { waitForMessage } = await import('@le-space/orbitdb-storage-bridge/backends/aleph-pin');
	/** @type {any} */
	const final =
		sent.status === 'pending'
			? await waitForMessage(sent.itemHash, {
					apiHost: endpoints.apiHost,
					timeout: settle.timeout ?? 60_000,
					interval: settle.interval ?? 2_000,
					...(f ? { fetch: f } : {})
				})
			: sent;
	if (final.status === 'rejected') {
		const why = final.details?.errors?.[0];
		if (why && typeof why === 'object' && why.required_credits !== undefined) {
			throw new BackupRefusedError('credits', {
				credits: Math.floor(Number(why.account_credits)),
				required: Math.ceil(Number(why.required_credits))
			});
		}
		throw new BackupRefusedError('rejected', { errorCode: final.errorCode ?? null });
	}
	return { itemHash: sent.itemHash, status: final.status };
}

/**
 * Have Aleph keep an uploaded backup: a STORE signed with this key for the
 * paying account, paid in credits, followed until Aleph has decided.
 *
 * @param {object} params
 * @param {string} params.cid what Aleph answered for the upload
 * @param {string} params.owner the paying account
 * @param {Uint8Array} params.key this browser's Aleph key
 * @param {AlephEndpoints} [params.endpoints]
 * @param {string} [params.ref] an increment's: the CID of the full backup it builds on
 * @param {number} [params.size] the file's bytes, into the STORE (`content.size`): a
 *   restore then knows what it fetches, and refuses a download that came back short
 * @param {typeof fetch} [params.fetch]
 * @param {{ timeout?: number, interval?: number }} [params.settle]
 * @returns {Promise<{ itemHash: string, status: string, sender: string, address: string, ref?: string }>}
 * @throws {BackupRefusedError} when Aleph refuses to keep it
 */
export async function keepWithKey({
	cid,
	owner,
	key,
	endpoints = alephEndpoints(),
	ref,
	size,
	fetch: f,
	settle = {}
}) {
	const { alephAddressOf } = await import('./aleph-signer.js');
	const pin = await backupPin({ owner, key, endpoints, fetch: f });
	const sent = await pin(cid, {
		...(ref ? { ref } : {}),
		...(Number.isInteger(size) ? { size } : {})
	});
	const final = await settleKept(sent, { endpoints, fetch: f, settle });
	return {
		itemHash: sent.itemHash,
		status: final.status,
		sender: alephAddressOf(key),
		address: owner,
		...(ref ? { ref } : {})
	};
}

/**
 * @typedef {{ itemHash: string, status: string, sender?: string, address?: string, ref?: string }} Kept
 *   what keeps a backup on Aleph, as the history records it
 * @typedef {{ backend: ReturnType<typeof import('@le-space/orbitdb-storage-bridge/backends/aleph').createAlephBackend>,
 *   keep: (handle: any, ref?: string) => Promise<Kept> }} BackupUploader
 */

/**
 * What a backup goes up with (backup/run.svelte.js): the storage bridge's
 * Aleph backend – the IPFS host, else an API node (since 2026-10-26 the
 * host takes no uploads) – and what keeps the upload afterwards.
 *
 * - This browser's key, granted: the backend gets the pin, Aleph's API node
 *   keeps the file in the same call as the upload, up to 1 GiB; `keep` only
 *   follows the message to its final status.
 * - Else the bridge signs: an upload without a message, up to 25 MiB on the
 *   API node, and the bridge's STORE afterwards.
 *
 * @param {object} params
 * @param {string} params.owner the paying account
 * @param {Uint8Array | null} params.key this browser's Aleph key
 * @param {boolean} params.granted whether the account lets that key keep backups
 * @param {AlephEndpoints} [params.endpoints]
 * @param {{ keep: (cid: string, ref?: string, size?: number) => Promise<{ itemHash: string, status: string, address?: string, ref?: string }>, address?: string } | null} [params.bridge]
 *   the paired bridge, when it signs instead
 * @param {typeof fetch} [params.fetch]
 * @returns {Promise<BackupUploader>}
 */
export async function createBackupUploader({
	owner,
	key,
	granted,
	endpoints = alephEndpoints(),
	bridge = null,
	fetch: f
}) {
	const [{ createAlephBackend }, { alephAddressOf }] = await Promise.all([
		import('@le-space/orbitdb-storage-bridge/backends/aleph'),
		import('./aleph-signer.js')
	]);
	const signs = granted && key ? await backupPin({ owner, key, endpoints, fetch: f }) : null;
	const backend = createAlephBackend({
		ingestUrl: endpoints.ingestUrl,
		apiHost: endpoints.apiHost,
		gateways: endpoints.gateways,
		...(signs ? { pin: signs } : {}),
		...(f ? { fetch: f } : {})
	});
	return {
		backend,
		async keep(handle, ref) {
			// Kept in the same call as the upload: Aleph's word on it is what is left to get.
			if (handle?.itemHash && key) {
				const final = await settleKept(
					{ itemHash: String(handle.itemHash), status: String(handle.status ?? 'pending') },
					{ endpoints, fetch: f }
				);
				return {
					itemHash: final.itemHash,
					status: final.status,
					sender: alephAddressOf(key),
					address: owner,
					...(ref ? { ref } : {})
				};
			}
			// The size goes into the STORE, so a restore knows what it fetches.
			const size = Number.isInteger(handle?.size) ? handle.size : undefined;
			if (granted && key)
				return keepWithKey({ cid: handle.id, owner, key, endpoints, ref, size, fetch: f });
			if (bridge) return { ...(await bridge.keep(handle.id, ref, size)), sender: bridge.address };
			throw new Error('Nothing can keep this backup: no granted key and no bridge.');
		}
	};
}

/**
 * The backups kept for the paying account, newest first, from Aleph's public
 * messages API: those the bridge sent and those this key sent alike. A full
 * backup carries no `ref`; an increment carries its full backup's CID, and
 * with `ref` only that chain's increments are listed.
 *
 * @param {{ owner: string, ref?: string, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<{ cid: string, itemHash: string, sender: string, owner: string, time: number, ref?: string, size?: number }[]>}
 *   `size`: the bytes the STORE names (absent on backups made before 0.26.2)
 */
export async function findBackups({ owner, ref, endpoints = alephEndpoints(), fetch: f }) {
	const { listAlephStores } = await import('@le-space/orbitdb-storage-bridge/backends/aleph-pin');
	const { stores } = await listAlephStores({
		owner,
		channel: BACKUP_CHANNEL,
		apiHost: endpoints.apiHost,
		...(ref ? { ref } : {}),
		...(f ? { fetch: f } : {})
	});
	return stores;
}

/**
 * Forget a chain of backups on Aleph (FORGET): its full backup – every STORE
 * that keeps that CID, a backup kept again has two – and every increment
 * that names it as `ref`, whoever sent them. Signed with this browser's key:
 * Aleph lets a FORGET's sender forget what it could have sent itself
 * (aleph-im/pyaleph#1156, live since 0.11), and the grant lets this key send
 * STORE on BELEGE-BACKUP for the account – also the bridge's own STOREs. The
 * files are unpinned and cost nothing from then on; nothing of that chain
 * can be restored again.
 *
 * @param {object} params
 * @param {string} params.base the chain's full backup's CID
 * @param {string} params.owner the paying account
 * @param {Uint8Array} params.key this browser's Aleph key
 * @param {AlephEndpoints} [params.endpoints]
 * @param {typeof fetch} [params.fetch]
 * @param {{ timeout?: number, interval?: number }} [params.settle]
 * @returns {Promise<{ forgotten: string[], rejected: string[], pending: string[], failed: string[] }>} item hashes
 */
export async function forgetChain({
	base,
	owner,
	key,
	endpoints = alephEndpoints(),
	fetch: f,
	settle = {}
}) {
	const [{ createAlephForget, forgetAlephStores }, { alephAddressOf, alephSign }] =
		await Promise.all([
			import('@le-space/orbitdb-storage-bridge/backends/aleph-pin'),
			import('./aleph-signer.js')
		]);
	const withFetch = f ? { fetch: f } : {};
	const forget = createAlephForget({
		sender: alephAddressOf(key),
		owner,
		sign: async (_address, message) => alephSign(key, message),
		apiHost: endpoints.apiHost,
		channel: BACKUP_CHANNEL,
		...withFetch
	});
	const common = {
		owner,
		channel: BACKUP_CHANNEL,
		forget,
		reason: `Belege: backup chain ${base} removed by its owner`,
		apiHost: endpoints.apiHost,
		settle: { timeout: settle.timeout ?? 60_000, interval: settle.interval ?? 2_000 },
		...withFetch
	};
	// The increments first: should the full backup's FORGET not go through,
	// what is left is still a backup one can restore.
	const increments = await forgetAlephStores({ ...common, ref: base });
	const full = await forgetAlephStores({
		...common,
		keep: (/** @type {{ cid: string, ref?: string }} */ s) => !(s.cid === base && !s.ref)
	});
	return {
		forgotten: [...increments.forgotten, ...full.forgotten],
		rejected: [...increments.rejected, ...full.rejected].map((r) => r.itemHash),
		pending: [...increments.pending, ...full.pending].map((r) => r.itemHash),
		failed: [...increments.failed, ...full.failed].map((r) => r.itemHash)
	};
}

/**
 * Credits a day for keeping one MiB on Aleph, paid in credits: what Aleph
 * asked for a day of a file when an account had too few (measured 2026-10-03,
 * the same rate as the fake in bridge/test/support/fake-aleph.js). An
 * estimate: Aleph sets the price, and says the real one only when it refuses.
 */
export const CREDITS_PER_MIB_DAY = 54;

/** About what keeping `bytes` costs a day, in credits. @param {number} bytes */
export const creditsPerDay = (bytes) => (bytes / 1048576) * CREDITS_PER_MIB_DAY;

/**
 * What Aleph says about a STORE now: `processed`, `pending`, `rejected`,
 * `forgotten` – or `unknown` when it does not know the message at all (a
 * request that never arrived, or was dropped before it was checked).
 *
 * @param {{ itemHash: string, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<string>}
 */
export async function storeStatus({ itemHash, endpoints = alephEndpoints(), fetch: f = fetch }) {
	const response = await f(`${endpoints.apiHost}/api/v0/messages/${encodeURIComponent(itemHash)}`);
	if (response.status === 404) return 'unknown';
	if (!response.ok) throw new Error(`Aleph did not answer: ${response.status}`);
	const body = /** @type {any} */ (await response.json());
	return typeof body?.status === 'string' ? body.status : 'unknown';
}
