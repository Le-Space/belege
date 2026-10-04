// Keeping a backup with this browser's own key (issue #77): the key made once
// and kept in the settings, the paying account in EIP-55 form, Aleph's hosts
// or the ones a bridge names, the STORE signed by this key for the account and
// paid in credits, a refusal with the amounts, the grant read from the
// account's `security` aggregate, and the backups found by owner. Against a
// fake Aleph in a fetch; every key, address and amount is made up.
import { describe, expect, it } from 'vitest';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { isAlephKey } from './aleph-key.js';
import { alephAddressOf, toChecksumAddress } from './aleph-signer.js';
import {
	BACKUP_CHANNEL,
	BackupRefusedError,
	KEY_SETTING,
	alephEndpoints,
	creditsOf,
	ensureBackupKey,
	findBackups,
	isGranted,
	keepWithKey,
	loadOwner,
	saveOwner
} from './keeper.js';

const OWNER = toChecksumAddress(`0x${'ab'.repeat(20)}`);
const endpoints = {
	ingestUrl: 'https://aleph.test/api/v0/add',
	apiHost: 'https://aleph.test',
	gateways: ['https://aleph.test/ipfs']
};
const text = (/** @type {string} */ s) => new TextEncoder().encode(s);

/**
 * The sealed settings collection, in memory, as the repository keeps it: a
 * record gets an id that sorts by when it was made, and the list is newest first.
 */
function memorySettings() {
	/** @type {any[]} */ const records = [];
	let made = 0;
	return /** @type {any} */ ({
		records,
		async list(/** @type {{ where?: (r: any) => boolean }} */ { where } = {}) {
			return records
				.filter((r) => !where || where(r))
				.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
		},
		async put(/** @type {any} */ record) {
			const stored = { ...record, id: record.id ?? String(++made).padStart(8, '0') };
			const at = records.findIndex((r) => r.id === stored.id);
			if (at >= 0) records[at] = stored;
			else records.push(stored);
			return stored;
		}
	});
}

/**
 * Aleph's API in a fetch, as measured (2026-10-03): a STORE is answered
 * `pending` and decided by the credits for a day of the file.
 *
 * @param {{ credits: number, grants?: any[], stores?: any[] }} account
 */
function fakeAleph({ credits, grants = [], stores = [] }) {
	/** @type {any[]} */ const posted = [];
	/** @type {string[]} */ const asked = [];
	/** @type {Map<string, any>} */ const status = new Map();
	const reply = (/** @type {number} */ code, /** @type {any} */ body) => ({
		ok: code < 300,
		status: code,
		json: async () => body,
		text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
	});
	const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
		asked.push(url);
		const { pathname } = new URL(url);
		if (pathname === '/api/v0/messages' && init?.method === 'POST') {
			const { message } = JSON.parse(init.body);
			posted.push(message);
			const content = JSON.parse(message.item_content);
			const required = 107.80493418375659 / 2; // a MiB-ish file, at the measured price
			status.set(
				message.item_hash,
				credits >= required
					? { status: 'processed' }
					: {
							status: 'rejected',
							error_code: 6,
							details: {
								errors: [
									{
										account_credits: String(credits),
										min_runtime_days: 1,
										required_credits: String(required)
									}
								]
							}
						}
			);
			expect(content.payment).toEqual({ type: 'credit' });
			return reply(202, { message_status: 'pending' });
		}
		const hash = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(pathname)?.[1];
		if (hash) return reply(200, status.get(hash));
		if (pathname === '/api/v0/messages.json') {
			return reply(200, { messages: stores, pagination_total: stores.length });
		}
		if (/^\/api\/v0\/aggregates\//.test(pathname)) {
			return grants.length
				? reply(200, { data: { security: { authorizations: grants } } })
				: reply(404, {});
		}
		if (/\/balance$/.test(pathname)) return reply(200, { credit_balance: credits });
		return reply(404, {});
	};
	return { fetchImpl: /** @type {any} */ (fetchImpl), posted, asked };
}

describe('this browser’s key and the paying account, in the sealed settings', () => {
	it('makes the key once and keeps it, as hex; a broken record gets a new key', async () => {
		const settings = memorySettings();
		const key = await ensureBackupKey(settings);
		expect(isAlephKey(key)).toBe(true);
		expect(await ensureBackupKey(settings)).toEqual(key);
		const [record] = settings.records;
		expect(record).toMatchObject({ key: KEY_SETTING });
		expect(record.value).toMatch(/^[0-9a-f]{64}$/);

		record.value = 'f'.repeat(64); // above the curve's order: no key
		const replaced = await ensureBackupKey(settings);
		expect(isAlephKey(replaced)).toBe(true);
		expect(replaced).not.toEqual(key);
		expect(await ensureBackupKey(settings)).toEqual(replaced);
	});

	it('the first key made for these books wins over one this browser made before they came back', async () => {
		const settings = memorySettings();
		const first = await ensureBackupKey(settings);
		// What a browser that made its own key first holds after the merge: a newer record.
		const newer = secp256k1.utils.randomSecretKey();
		await settings.put({ key: KEY_SETTING, value: Buffer.from(newer).toString('hex') });
		expect(await ensureBackupKey(settings)).toEqual(first);
	});

	it('keeps the paying account in EIP-55 form, and refuses what is no address', async () => {
		const settings = memorySettings();
		expect(await loadOwner(settings)).toBeNull();
		expect(await saveOwner(settings, OWNER.toLowerCase())).toBe(OWNER);
		expect(await loadOwner(settings)).toBe(OWNER);
		await expect(saveOwner(settings, '0x1234')).rejects.toThrow(/Not an address/);
	});
});

describe('where Aleph is', () => {
	it('its own hosts, or the https and loopback ones a bridge names, nothing else', () => {
		expect(alephEndpoints(null)).toEqual({
			ingestUrl: 'https://ipfs.aleph.cloud/api/v0/add',
			apiHost: 'https://api2.aleph.im',
			gateways: ['https://ipfs.aleph.cloud/ipfs']
		});
		const fake = 'http://127.0.0.1:4555';
		expect(
			alephEndpoints({
				ingestUrl: `${fake}/api/v0/add`,
				apiHost: fake,
				gateways: [`${fake}/ipfs`]
			})
		).toEqual({ ingestUrl: `${fake}/api/v0/add`, apiHost: fake, gateways: [`${fake}/ipfs`] });
		expect(
			alephEndpoints({
				ingestUrl: 'http://aleph.example/api/v0/add',
				apiHost: 'http://aleph.example',
				gateways: ['http://aleph.example/ipfs']
			})
		).toEqual(alephEndpoints(null));
	});
});

describe('keeping it on Aleph with this browser’s key', () => {
	const key = secp256k1.utils.randomSecretKey();

	it('signs the STORE for the paying account, on BELEGE-BACKUP, paid in credits', async () => {
		const aleph = fakeAleph({ credits: 1_000_000 });
		const kept = await keepWithKey({
			cid: 'QmBackup1',
			owner: OWNER,
			key,
			endpoints,
			fetch: aleph.fetchImpl,
			settle: { timeout: 10, interval: 1 }
		});
		expect(kept).toEqual({
			itemHash: aleph.posted[0].item_hash,
			status: 'processed',
			sender: alephAddressOf(key),
			address: OWNER
		});

		const [message] = aleph.posted;
		expect(message).toMatchObject({ type: 'STORE', channel: BACKUP_CHANNEL, sender: kept.sender });
		expect(JSON.parse(message.item_content)).toMatchObject({
			address: OWNER,
			item_hash: 'QmBackup1',
			item_type: 'ipfs'
		});
		// The signature is the sender's: recovered from what Aleph checks.
		const payload = text(['ETH', message.sender, 'STORE', message.item_hash].join('\n'));
		const digest = keccak_256(
			new Uint8Array([...text(`\x19Ethereum Signed Message:\n${payload.length}`), ...payload])
		);
		const signature = Uint8Array.from(Buffer.from(message.signature.slice(2), 'hex'));
		const point = secp256k1.Point.fromBytes(
			secp256k1.recoverPublicKey(
				new Uint8Array([signature[64] - 27, ...signature.subarray(0, 64)]),
				digest,
				{ prehash: false }
			)
		).toBytes(false);
		expect(
			toChecksumAddress(`0x${Buffer.from(keccak_256(point.slice(1)).slice(-20)).toString('hex')}`)
		).toBe(kept.sender);
	});

	it('an account without enough credit: refused, with what it has and what a day takes', async () => {
		const aleph = fakeAleph({ credits: 0 });
		const refused = await keepWithKey({
			cid: 'QmBackup1',
			owner: OWNER,
			key,
			endpoints,
			fetch: aleph.fetchImpl,
			settle: { timeout: 10, interval: 1 }
		}).catch((error) => error);
		expect(refused).toBeInstanceOf(BackupRefusedError);
		expect(refused.kind).toBe('credits');
		expect(refused.reason).toEqual({ credits: 0, required: 54 });
	});

	it('reads the grant on BELEGE-BACKUP, not one on another channel, and the credits', async () => {
		const address = alephAddressOf(key);
		const granted = fakeAleph({
			credits: 1234.5,
			grants: [
				{
					address: address.toLowerCase(),
					types: ['STORE'],
					channels: [BACKUP_CHANNEL],
					chain: 'ETH'
				}
			]
		});
		expect(await isGranted({ owner: OWNER, address, endpoints, fetch: granted.fetchImpl })).toBe(
			true
		);
		expect(await creditsOf({ owner: OWNER, endpoints, fetch: granted.fetchImpl })).toBe(1234.5);

		const otherChannel = fakeAleph({
			credits: 0,
			grants: [{ address, types: ['STORE'], channels: ['INVOICE-BACKUP'] }]
		});
		expect(
			await isGranted({ owner: OWNER, address, endpoints, fetch: otherChannel.fetchImpl })
		).toBe(false);
		const none = fakeAleph({ credits: 0 });
		expect(await isGranted({ owner: OWNER, address, endpoints, fetch: none.fetchImpl })).toBe(
			false
		);
	});

	it('finds the account’s backups by owner on BELEGE-BACKUP, whoever sent them', async () => {
		const bridge = toChecksumAddress(`0x${'cd'.repeat(20)}`);
		const aleph = fakeAleph({
			credits: 0,
			stores: [
				{
					item_hash: 'h1',
					sender: bridge,
					channel: BACKUP_CHANNEL,
					content: { address: OWNER, item_type: 'ipfs', item_hash: 'QmByBridge', time: 10 }
				},
				{
					item_hash: 'h2',
					sender: alephAddressOf(key),
					channel: BACKUP_CHANNEL,
					content: { address: OWNER, item_type: 'ipfs', item_hash: 'QmByBrowser', time: 20 }
				}
			]
		});
		const stores = await findBackups({ owner: OWNER, endpoints, fetch: aleph.fetchImpl });
		expect(stores.map((s) => s.cid)).toEqual(['QmByBrowser', 'QmByBridge']);
		const url = new URL(aleph.asked[0]);
		expect(url.searchParams.get('owners')).toBe(OWNER);
		expect(url.searchParams.get('channels')).toBe(BACKUP_CHANNEL);
	});
});
