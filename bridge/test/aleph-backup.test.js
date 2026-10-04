// The backup's copy on Aleph (issue #77): the key and its signature, setup:aleph,
// and /backup end to end against a fake Aleph on 127.0.0.1. All keys, addresses
// and bytes made up.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAlephPin } from '@le-space/orbitdb-storage-bridge/backends/aleph-pin';
import { createAlephBackend } from '@le-space/orbitdb-storage-bridge/backends/aleph';

import {
	BACKUP_CHANNEL,
	addressOf,
	createAlephBackup,
	isBackupKey,
	personalSign
} from '../src/aleph-backup.js';
import { startBridge } from '../src/index.js';
import { defaultConfig, loadConfig, saveConfig } from '../src/config.js';
import { memoryKeychain } from '../src/keychain.js';
import { runAlephGrants, runAlephSetup } from '../src/setup-aleph.js';
import { startFakeAleph } from './support/fake-aleph.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';
/** A made-up key, and another. */
const KEY = createHash('sha256').update('belege backup test key').digest('hex');
const OTHER = createHash('sha256').update('somebody else').digest('hex');
/** A made-up key with no credits on its account. */
const POOR = createHash('sha256').update('an account with no credits').digest('hex');
/** A made-up key an application holds, which KEY's account may let keep backups. */
const DELEGATE = createHash('sha256').update('an application in a browser').digest('hex');

/** @type {string} */ let dir;
/** @type {Awaited<ReturnType<typeof startFakeAleph>>} */ let aleph;

before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-aleph-backup-'));
	aleph = await startFakeAleph({
		accounts: {
			[addressOf(KEY)]: { balance: 1_500_000, rows: [] },
			[addressOf(OTHER)]: { balance: 1_500_000, rows: [] }
		}
	});
});
after(async () => {
	await aleph?.close();
	await rm(dir, { recursive: true, force: true });
});

test('the key: its address and personal_sign as an Ethereum wallet has them', () => {
	// The example from the web3.js documentation (eth.accounts.sign), a public test key.
	const doc = '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318';
	assert.equal(addressOf(doc), '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23');
	assert.equal(
		personalSign(doc, 'Some data'),
		'0xb91467e570a6466aa9e9876cbcd013baba02900b8979d43fe208a4a4f339f5fd6007e74cd82e037b800186422fc2da167c747ef045e5d18a5f5d4300f8e1a0291c'
	);
	assert.equal(isBackupKey(KEY), true);
	assert.equal(isBackupKey(`0x${KEY}`), true);
	assert.equal(isBackupKey('0'.repeat(64)), false, 'zero is no key');
	assert.equal(isBackupKey('xyz'), false);
});

test('the fake takes a STORE only signed by its sender, as Aleph does: else pending', async () => {
	const backend = createAlephBackend({ ingestUrl: `${aleph.url}/api/v0/add` });
	const { id } = await backend.putBlob(new Uint8Array([1, 2, 3]), { name: 'x.bin' });
	const pin = createAlephPin({
		sender: addressOf(KEY),
		sign: async (_a, message) => personalSign(OTHER, message),
		apiHost: aleph.url
	});
	assert.equal((await pin(id)).status, 'pending');
	const good = createAlephPin({
		sender: addressOf(KEY),
		sign: async (_a, message) => personalSign(KEY, message),
		apiHost: aleph.url
	});
	assert.equal((await good(id)).status, 'processed');
	await assert.rejects(good('QmNichtHochgeladen'), /422/, 'a CID nobody uploaded');
});

describe('setup:aleph', () => {
	/** @param {string[]} answers */
	const io = (answers = []) => {
		/** @type {string[]} */ const out = [];
		return {
			out,
			io: {
				ask: async () => answers.shift() ?? '',
				print: (/** @type {string} */ l) => out.push(l)
			}
		};
	};

	test('makes a key into the keychain, the flag into the config, and prints the address, never the key', async () => {
		const configPath = join(dir, 'setup.json');
		await saveConfig(defaultConfig(), configPath);
		const keychain = memoryKeychain(null, 'aleph-backup');
		const first = io();
		assert.equal(
			await runAlephSetup({ io: first.io, keychain, configPath, makeKey: () => KEY }),
			true
		);
		assert.equal(await keychain.read(), KEY);
		assert.equal((await loadConfig(configPath)).alephBackup.configured, true);
		assert.doesNotMatch(await readFile(configPath, 'utf8'), new RegExp(KEY));
		assert.ok(first.out.some((l) => l.includes(addressOf(KEY))));
		assert.ok(first.out.every((l) => !l.includes(KEY)));

		const again = io();
		await runAlephSetup({ io: again.io, keychain, configPath, makeKey: () => OTHER });
		assert.equal(await keychain.read(), KEY, 'a second run keeps the key');
		assert.ok(again.out.some((l) => l.includes(addressOf(KEY))));
	});

	test('--new replaces it only on yes, and says the old backups stay with the old account', async () => {
		const configPath = join(dir, 'new.json');
		await saveConfig(defaultConfig(), configPath);
		const keychain = memoryKeychain(KEY, 'aleph-backup');
		const no = io(['']);
		await runAlephSetup({ io: no.io, keychain, configPath, replace: true, makeKey: () => OTHER });
		assert.equal(await keychain.read(), KEY);
		assert.ok(no.out.some((l) => /stay with the old one/.test(l)));
		await runAlephSetup({
			io: io(['y']).io,
			keychain,
			configPath,
			replace: true,
			makeKey: () => OTHER
		});
		assert.equal(await keychain.read(), OTHER);
	});

	test('--authorize lets another key keep backups on one channel; --grants lists, --revoke takes it back', async () => {
		const keychain = memoryKeychain(KEY, 'aleph-backup');
		const run = async (/** @type {any} */ options) => {
			const printed = io();
			const ok = await runAlephGrants({
				io: printed.io,
				keychain,
				apiHost: aleph.url,
				...options
			});
			// The bridge's key is never printed, whatever the command.
			assert.ok(printed.out.every((l) => !l.includes(KEY)));
			return { ok, out: printed.out.join('\n') };
		};
		const delegate = addressOf(DELEGATE);

		assert.match((await run({ action: 'grants' })).out, /No other key may keep backups/);

		const granted = await run({
			action: 'authorize',
			address: delegate.toLowerCase(),
			channel: 'INVOICE-BACKUP'
		});
		assert.equal(granted.ok, true);
		assert.match(granted.out, new RegExp(`${delegate} may now keep backups on INVOICE-BACKUP`));
		assert.match(granted.out, new RegExp(`${delegate}  STORE  on INVOICE-BACKUP`));

		// A second channel joins the first, it does not replace it.
		await run({ action: 'authorize', address: delegate, channel: 'BELEGE-BACKUP' });
		assert.match(
			(await run({ action: 'grants' })).out,
			new RegExp(`${delegate}  STORE  on INVOICE-BACKUP,BELEGE-BACKUP`)
		);

		const revoked = await run({ action: 'revoke', address: delegate });
		assert.equal(revoked.ok, true);
		assert.match(revoked.out, /may no longer keep backups/);
		assert.match(revoked.out, /No other key may keep backups/);
	});

	test('--authorize refuses what is no address, no channel, or the account itself; and wants a key', async () => {
		const keychain = memoryKeychain(KEY, 'aleph-backup');
		const run = async (/** @type {any} */ options) => {
			const printed = io();
			const ok = await runAlephGrants({ io: printed.io, keychain, apiHost: aleph.url, ...options });
			return { ok, out: printed.out.join('\n') };
		};
		const delegate = addressOf(DELEGATE);
		assert.deepEqual(await run({ action: 'authorize', address: '0x123', channel: 'X' }), {
			ok: false,
			out: 'That is not an address: 0x and 40 hexadecimal characters, as the application shows it.'
		});
		assert.match(
			(await run({ action: 'authorize', address: delegate })).out,
			/--channel INVOICE-BACKUP/
		);
		assert.match(
			(await run({ action: 'authorize', address: delegate, channel: 'lower case' })).out,
			/--channel/
		);
		assert.match(
			(await run({ action: 'authorize', address: addressOf(KEY), channel: 'X-BACKUP' })).out,
			/needs no grant/
		);
		const none = io();
		assert.equal(
			await runAlephGrants({
				io: none.io,
				keychain: memoryKeychain(null, 'aleph-backup'),
				action: 'grants',
				apiHost: aleph.url
			}),
			false
		);
		assert.match(none.out.join('\n'), /pnpm setup:aleph/);
	});
});

describe('/backup', () => {
	/**
	 * @param {{ configured: boolean, key?: string | null }} options
	 */
	async function bridgeWith({ configured, key = KEY }) {
		const configPath = join(dir, `bridge-${configured}-${Math.random()}.json`);
		await saveConfig({ ...defaultConfig(), alephBackup: { configured } }, configPath);
		/** @type {string[]} */ const printed = [];
		/** @type {string[]} */ const logged = [];
		const bridge = await startBridge({
			configPath,
			keychain: memoryKeychain(null),
			alephBackupKeychain: memoryKeychain(key, 'aleph-backup'),
			alephApi: aleph.url,
			alephIngestUrl: `${aleph.url}/api/v0/add`,
			port: 0,
			print: (l) => printed.push(l),
			log: (l) => logged.push(l)
		});
		const port = bridge.address.port;
		const code = printed.join('\n').match(/\b([A-Z2-9]{4}[- ]?[A-Z2-9]{4})\b/)?.[1];
		const paired = await request(port, '/pair', {
			method: 'POST',
			headers: { origin: APP },
			body: { code }
		});
		const auth = { origin: APP, authorization: `Bearer ${paired.json.token}` };
		return { bridge, port, auth, logged };
	}

	test('uploads the sealed bytes, has them kept by the own key, and logs no CID or address', async () => {
		const { bridge, port, auth, logged } = await bridgeWith({ configured: true });
		try {
			const health = await request(port, '/health', { headers: { origin: APP } });
			assert.deepEqual(health.json.backup, { aleph: true });

			const status = await request(port, '/backup/status', { headers: auth });
			assert.deepEqual(status.json, {
				aleph: {
					configured: true,
					address: addressOf(KEY),
					credits: 1_500_000,
					ingestUrl: `${aleph.url}/api/v0/add`,
					gateways: [`${aleph.url}/ipfs`],
					apiHost: aleph.url
				}
			});

			const bytes = new Uint8Array(randomBytes(4096));
			const res = await request(port, '/backup/aleph?name=belege-2026-10-02.car', {
				method: 'POST',
				headers: auth,
				body: bytes
			});
			assert.equal(res.status, 200, res.text);
			assert.equal(res.json.status, 'processed');
			assert.equal(res.json.size, 4096);
			assert.equal(res.json.address, addressOf(KEY));
			assert.match(res.json.itemHash, /^[0-9a-f]{64}$/);
			assert.deepEqual(aleph.added.get(res.json.cid), bytes, 'the bytes arrived as they were');
			const last = /** @type {any} */ (aleph.stores.at(-1));
			const store = {
				sender: last.sender,
				cid: last.cid,
				channel: last.channel,
				status: last.status
			};
			assert.deepEqual(store, {
				sender: addressOf(KEY),
				cid: res.json.cid,
				channel: BACKUP_CHANNEL,
				status: 'processed'
			});
			assert.ok(logged.some((l) => /backup: 4096 byte\(s\) to Aleph, processed/.test(l)));
			assert.ok(logged.every((l) => !l.includes(res.json.cid) && !l.includes(addressOf(KEY))));
		} finally {
			await bridge.close();
		}
	});

	test('lists what this account had kept, newest first, and the app gets it back from the gateway', async () => {
		const { bridge, port, auth } = await bridgeWith({ configured: true });
		try {
			/** @type {string[]} */ const cids = [];
			for (const name of ['first.car', 'second.car']) {
				const { id } = await createAlephBackend({ ingestUrl: `${aleph.url}/api/v0/add` }).putBlob(
					new Uint8Array(randomBytes(512)),
					{ name }
				);
				await request(port, '/backup/aleph/pin', {
					method: 'POST',
					headers: auth,
					body: { cid: id }
				});
				cids.push(id);
				await new Promise((r) => setTimeout(r, 1100)); // a STORE's time is in seconds
			}
			// Somebody else's STORE on the same channel is not ours to list.
			const { id: foreign } = await createAlephBackend({
				ingestUrl: `${aleph.url}/api/v0/add`
			}).putBlob(new Uint8Array([9]), { name: 'x' });
			await createAlephPin({
				sender: addressOf(OTHER),
				sign: async (_a, m) => personalSign(OTHER, m),
				apiHost: aleph.url,
				channel: BACKUP_CHANNEL
			})(foreign);

			const res = await request(port, '/backup/aleph/list', { headers: auth });
			assert.equal(res.status, 200, res.text);
			const listed = res.json.backups.map((/** @type {any} */ b) => b.cid);
			assert.deepEqual(listed.slice(0, 2), [cids[1], cids[0]], 'newest first');
			assert.equal(listed.includes(foreign), false);
			assert.match(res.json.backups[0].at, /^\d{4}-\d{2}-\d{2}T/);

			// The gateway the status names gives the bytes back as they went up.
			const status = await request(port, '/backup/status', { headers: auth });
			const got = await fetch(`${status.json.aleph.gateways[0]}/${cids[1]}`);
			assert.equal(got.status, 200);
			assert.deepEqual(
				new Uint8Array(await got.arrayBuffer()),
				aleph.added.get(cids[1]),
				'the same bytes'
			);
		} finally {
			await bridge.close();
		}
	});

	test('lists what a key this account allowed kept for it (by owners), not what an unallowed one tried', async () => {
		const { bridge, port, auth } = await bridgeWith({ configured: true });
		try {
			await runAlephGrants({
				io: { print: () => {} },
				keychain: memoryKeychain(KEY, 'aleph-backup'),
				action: 'authorize',
				address: addressOf(DELEGATE),
				channel: BACKUP_CHANNEL,
				apiHost: aleph.url
			});
			const upload = async () =>
				(
					await createAlephBackend({ ingestUrl: `${aleph.url}/api/v0/add` }).putBlob(
						new Uint8Array(randomBytes(256)),
						{ name: 'from-the-browser.car' }
					)
				).id;
			// What a browser does with the key it holds: sign the STORE itself, for this account.
			const byDelegate = await upload();
			const kept = await createAlephPin({
				sender: addressOf(DELEGATE),
				owner: addressOf(KEY),
				sign: async (_a, m) => personalSign(DELEGATE, m),
				apiHost: aleph.url,
				channel: BACKUP_CHANNEL
			})(byDelegate);
			assert.equal(kept.status, 'processed', 'the account pays, the delegate holds no credits');

			// The same for a key nobody allowed: Aleph does not keep it.
			const byStranger = await upload();
			const refused = await createAlephPin({
				sender: addressOf(POOR),
				owner: addressOf(KEY),
				sign: async (_a, m) => personalSign(POOR, m),
				apiHost: aleph.url,
				channel: BACKUP_CHANNEL
			})(byStranger);
			assert.equal(refused.status, 'pending', 'Aleph answers pending, and then rejects it');

			const listed = (
				await request(port, '/backup/aleph/list', { headers: auth })
			).json.backups.map((/** @type {any} */ b) => b.cid);
			assert.equal(listed[0], byDelegate, 'newest first, though another key sent it');
			assert.equal(listed.includes(byStranger), false);
		} finally {
			await bridge.close();
		}
	});

	test('an account that cannot pay for a day: refused with how many credits it takes, nothing logged that names it', async () => {
		const { bridge, port, auth, logged } = await bridgeWith({ configured: true, key: POOR });
		try {
			const { id } = await createAlephBackend({ ingestUrl: `${aleph.url}/api/v0/add` }).putBlob(
				new Uint8Array(randomBytes(3 * 1024 * 1024)),
				{ name: 'belege-2026-10-04.car' }
			);
			const res = await request(port, '/backup/aleph/pin', {
				method: 'POST',
				headers: auth,
				body: { cid: id }
			});
			assert.equal(res.status, 402, res.text);
			assert.equal(res.json.code, 'ALEPH_BACKUP_REJECTED');
			// 3 MiB for a day, at the price Aleph asked on 2026-10-03: 161.7 credits.
			assert.deepEqual(res.json.reason, { credits: 0, required: 162 });
			assert.match(res.json.error, /has 0 credits, and keeping this backup for a day needs 162/);
			assert.equal(aleph.stores.at(-1)?.status, 'rejected');
			for (const secret of [id, addressOf(POOR)]) {
				assert.ok(!res.json.error.includes(secret));
				assert.ok(logged.every((l) => !l.includes(secret)));
			}
		} finally {
			await bridge.close();
		}
	});

	test('the app uploads itself, the bridge only signs the STORE: kept, and nothing else uploaded', async () => {
		const { bridge, port, auth, logged } = await bridgeWith({ configured: true });
		try {
			// What the browser does: Aleph's IPFS host, no key.
			const bytes = new Uint8Array(randomBytes(2048));
			const { id } = await createAlephBackend({ ingestUrl: `${aleph.url}/api/v0/add` }).putBlob(
				bytes,
				{ name: 'belege-2026-10-02.car' }
			);
			const added = aleph.added.size;
			const res = await request(port, '/backup/aleph/pin', {
				method: 'POST',
				headers: auth,
				body: { cid: id }
			});
			assert.equal(res.status, 200, res.text);
			assert.equal(res.json.status, 'processed');
			assert.equal(res.json.cid, id);
			assert.equal(res.json.address, addressOf(KEY));
			assert.equal(aleph.added.size, added, 'the bridge uploaded nothing');
			const last = /** @type {any} */ (aleph.stores.at(-1));
			assert.deepEqual(
				{ sender: last.sender, cid: last.cid, channel: last.channel, status: last.status },
				{
					sender: addressOf(KEY),
					cid: id,
					channel: BACKUP_CHANNEL,
					status: 'processed'
				}
			);
			assert.ok(logged.every((l) => !l.includes(id)));

			const bad = await request(port, '/backup/aleph/pin', {
				method: 'POST',
				headers: auth,
				body: { cid: '../../etc' }
			});
			assert.equal(bad.status, 400);
			assert.equal(bad.json.code, 'ALEPH_BACKUP_CID');
		} finally {
			await bridge.close();
		}
		const off = await bridgeWith({ configured: false });
		try {
			const res = await request(off.port, '/backup/aleph/pin', {
				method: 'POST',
				headers: off.auth,
				body: { cid: 'Qm' + '1'.repeat(44) }
			});
			assert.equal(res.status, 503);
		} finally {
			await off.bridge.close();
		}
	});

	test('refuses an odd name and an empty backup; says how to set it up when it is not', async () => {
		const { bridge, port, auth } = await bridgeWith({ configured: true });
		try {
			const odd = await request(port, '/backup/aleph?name=../etc', {
				method: 'POST',
				headers: auth,
				body: new Uint8Array([1])
			});
			assert.equal(odd.status, 400);
			const empty = await request(port, '/backup/aleph', {
				method: 'POST',
				headers: auth,
				body: new Uint8Array(0)
			});
			assert.equal(empty.status, 400);
		} finally {
			await bridge.close();
		}
		const off = await bridgeWith({ configured: false });
		try {
			assert.deepEqual((await request(off.port, '/backup/status', { headers: off.auth })).json, {
				aleph: { configured: false }
			});
			const res = await request(off.port, '/backup/aleph', {
				method: 'POST',
				headers: off.auth,
				body: new Uint8Array([1])
			});
			assert.equal(res.status, 503);
			assert.match(res.json.error, /setup:aleph/);
		} finally {
			await off.bridge.close();
		}
	});

	test('a keychain entry that is no key: 503 with the setup command, nothing uploaded', async () => {
		const before = aleph.added.size;
		const { bridge, port, auth } = await bridgeWith({ configured: true, key: 'kein schluessel' });
		try {
			const res = await request(port, '/backup/aleph', {
				method: 'POST',
				headers: auth,
				body: new Uint8Array([1, 2])
			});
			assert.equal(res.status, 503);
			assert.equal(res.json.code, 'ALEPH_BACKUP_KEY');
			assert.equal(aleph.added.size, before);
		} finally {
			await bridge.close();
		}
	});

	test('the backup object alone: Aleph refusing the upload is an error, not a backup', async () => {
		const backup = createAlephBackup({
			getKey: async () => KEY,
			ingestUrl: `${aleph.url}/nowhere`,
			apiHost: aleph.url
		});
		await assert.rejects(backup.put(new Uint8Array([1]), { name: 'x.car' }), /404/);
	});
});
