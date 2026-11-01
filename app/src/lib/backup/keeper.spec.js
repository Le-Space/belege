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
	CREDITS_PER_MIB_DAY,
	alephEndpoints,
	creditsOf,
	creditsPerDay,
	ensureBackupKey,
	findBackups,
	forgetChain,
	isGranted,
	keepWithKey,
	loadOwner,
	saveOwner,
	storeStatus
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

describe('after the backup went up', () => {
	/** @param {number} code @param {unknown} [body] @returns {typeof fetch} */
	const answering = (code, body) =>
		/** @type {any} */ (
			async (/** @type {string} */ url) => {
				expect(url).toBe(`https://aleph.test/api/v0/messages/${'c'.repeat(64)}`);
				return new Response(JSON.stringify(body ?? {}), { status: code });
			}
		);

	it('asks Aleph what became of a STORE, and says when Aleph does not know it', async () => {
		const ask = (/** @type {typeof fetch} */ f) =>
			storeStatus({ itemHash: 'c'.repeat(64), endpoints, fetch: f });
		expect(await ask(answering(200, { status: 'processed' }))).toBe('processed');
		expect(await ask(answering(200, { status: 'pending' }))).toBe('pending');
		expect(await ask(answering(200, { status: 'rejected', error_code: 6 }))).toBe('rejected');
		expect(await ask(answering(404, { error: 'not found' }))).toBe('unknown');
		await expect(ask(answering(503))).rejects.toThrow('503');
	});

	it('estimates what keeping a backup costs a day', () => {
		expect(creditsPerDay(1048576)).toBe(CREDITS_PER_MIB_DAY);
		// The 499 MB a full set of books came to: about 25,700 a day.
		expect(Math.round(creditsPerDay(499_333_147))).toBe(25715);
	});
});

describe('forgetting an older chain', () => {
	const key = new Uint8Array(32).fill(7);
	it('forgets its increments, then every STORE of its full backup, signed by this key for the account', async () => {
		const bridge = toChecksumAddress(`0x${'cd'.repeat(20)}`);
		const store = (
			/** @type {string} */ hash,
			/** @type {string} */ cid,
			/** @type {string} */ ref = ''
		) => ({
			item_hash: hash,
			sender: bridge,
			channel: BACKUP_CHANNEL,
			content: {
				address: OWNER,
				item_type: 'ipfs',
				item_hash: cid,
				time: 1,
				...(ref ? { ref } : {})
			}
		});
		const kept = [
			store('a'.repeat(64), 'QmOld'),
			store('b'.repeat(64), 'QmOld'),
			store('c'.repeat(64), 'QmOldInc1', 'QmOld'),
			store('d'.repeat(64), 'QmNew'),
			store('e'.repeat(64), 'QmNewInc1', 'QmNew')
		];
		/** @type {any[]} */ const posted = [];
		const fetchImpl = async (/** @type {string} */ url, /** @type {any} */ init) => {
			const u = new URL(url);
			const ok = (/** @type {any} */ body) => ({
				ok: true,
				status: 200,
				json: async () => body,
				text: async () => ''
			});
			if (u.pathname === '/api/v0/messages' && init?.method === 'POST') {
				posted.push(JSON.parse(init.body).message);
				return ok({ message_status: 'processed' });
			}
			if (u.pathname === '/api/v0/messages.json') {
				const refs = u.searchParams.get('refs');
				const matched = kept.filter((m) => !refs || m.content.ref === refs);
				return ok({ messages: matched, pagination_total: matched.length });
			}
			return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
		};
		const result = await forgetChain({
			base: 'QmOld',
			owner: OWNER,
			key,
			endpoints,
			fetch: /** @type {any} */ (fetchImpl)
		});
		expect(
			posted.map((m) => [m.type, m.sender, m.channel, JSON.parse(m.item_content).hashes])
		).toEqual([
			['FORGET', alephAddressOf(key), BACKUP_CHANNEL, ['c'.repeat(64)]],
			['FORGET', alephAddressOf(key), BACKUP_CHANNEL, ['a'.repeat(64), 'b'.repeat(64)]]
		]);
		expect(JSON.parse(posted[0].item_content).address).toBe(OWNER);
		expect(result.forgotten).toEqual(['c'.repeat(64), 'a'.repeat(64), 'b'.repeat(64)]);
		expect(result.rejected).toEqual([]);
	});
});
