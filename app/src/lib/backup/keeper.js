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
 * Have Aleph keep an uploaded backup: a STORE signed with this key for the
 * paying account, paid in credits, followed until Aleph has decided.
 *
 * @param {object} params
 * @param {string} params.cid what Aleph's IPFS host answered
 * @param {string} params.owner the paying account
 * @param {Uint8Array} params.key this browser's Aleph key
 * @param {AlephEndpoints} [params.endpoints]
 * @param {typeof fetch} [params.fetch]
 * @param {{ timeout?: number, interval?: number }} [params.settle]
 * @returns {Promise<{ itemHash: string, status: string, sender: string, address: string }>}
 * @throws {BackupRefusedError} when Aleph refuses to keep it
 */
export async function keepWithKey({
	cid,
	owner,
	key,
	endpoints = alephEndpoints(),
	fetch: f,
	settle = {}
}) {
	const [{ createAlephPin, waitForMessage }, { alephAddressOf, alephSign }] = await Promise.all([
		import('@le-space/orbitdb-storage-bridge/backends/aleph-pin'),
		import('./aleph-signer.js')
	]);
	const withFetch = f ? { fetch: f } : {};
	const sender = alephAddressOf(key);
	const sent = await createAlephPin({
		sender,
		owner,
		sign: async (_address, message) => alephSign(key, message),
		apiHost: endpoints.apiHost,
		channel: BACKUP_CHANNEL,
		...withFetch
	})(cid);
	/** @type {any} */
	const final =
		sent.status === 'pending'
			? await waitForMessage(sent.itemHash, {
					apiHost: endpoints.apiHost,
					timeout: settle.timeout ?? 60_000,
					interval: settle.interval ?? 2_000,
					...withFetch
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
	return { itemHash: sent.itemHash, status: final.status, sender, address: owner };
}

/**
 * The backups kept for the paying account, newest first, from Aleph's public
 * messages API: those the bridge sent and those this key sent alike.
 *
 * @param {{ owner: string, endpoints?: AlephEndpoints, fetch?: typeof fetch }} params
 * @returns {Promise<{ cid: string, itemHash: string, sender: string, owner: string, time: number }[]>}
 */
export async function findBackups({ owner, endpoints = alephEndpoints(), fetch: f }) {
	const { listAlephStores } = await import('@le-space/orbitdb-storage-bridge/backends/aleph-pin');
	const { stores } = await listAlephStores({
		owner,
		channel: BACKUP_CHANNEL,
		apiHost: endpoints.apiHost,
		...(f ? { fetch: f } : {})
	});
	return stores;
}
