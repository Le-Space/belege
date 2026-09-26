// Bitcoin wallets: keys, addresses, and a wallet's history read from a fake
// Esplora API. The key is the public test key of BIP84 (the "abandon … about"
// test mnemonic), the other addresses are made up; nothing goes to the network.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { HDKey } from '@scure/bip32';

import {
	createWalletService,
	deriveAddress,
	keyFingerprint,
	normalizeBitcoin,
	parseExtendedKey,
	parseStoredKey
} from '../src/chains/index.js';
import { CHAINS } from '../src/chains/registry.js';
import { runBitcoinSetup } from '../src/setup-bitcoin.js';
import { memoryKeychain } from '../src/keychain.js';

const SEED = pbkdf2Sync(
	'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
	'mnemonic',
	2048,
	64,
	'sha512'
);
/** @param {string} path @param {{ private: number, public: number }} versions */
const accountKey = (path, versions) =>
	HDKey.fromMasterSeed(SEED, versions).derive(path).publicExtendedKey;
const ZPUB = accountKey("m/84'/0'/0'", { private: 0x04b2430c, public: 0x04b24746 });
const YPUB = accountKey("m/49'/0'/0'", { private: 0x049d7878, public: 0x049d7cb2 });
const XPUB44 = accountKey("m/44'/0'/0'", { private: 0x0488ade4, public: 0x0488b21e });

const BTC = /** @type {import('../src/chains/registry.js').BitcoinChain} */ (CHAINS.bitcoin);

describe('keys and addresses', () => {
	test('each kind of key gives the address its BIP names', () => {
		const z = parseExtendedKey(ZPUB);
		assert.equal(z.type, 'p2wpkh');
		assert.equal(
			deriveAddress(z.account, z.type, 0, 0),
			'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'
		);
		const y = parseExtendedKey(YPUB);
		assert.equal(deriveAddress(y.account, y.type, 0, 0), '37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf');
		const x = parseExtendedKey(XPUB44, 'p2pkh');
		assert.equal(deriveAddress(x.account, x.type, 0, 0), '1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
	});

	test('an xpub needs its type; a zpub cannot be another; nonsense and private keys are refused', () => {
		assert.throws(() => parseExtendedKey(XPUB44), /address type/);
		assert.throws(() => parseExtendedKey(ZPUB, 'p2pkh'), /is p2wpkh/);
		assert.throws(() => parseExtendedKey('zpub123'), /not a valid/);
		assert.throws(
			() => parseExtendedKey('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'),
			/xpub, ypub or zpub/
		);
		const zprv = HDKey.fromMasterSeed(SEED, { private: 0x04b2430c, public: 0x04b24746 }).derive(
			"m/84'/0'/0'"
		).privateExtendedKey;
		assert.throws(() => parseExtendedKey(zprv), /xpub, ypub or zpub/);
	});

	test('the keychain entry: JSON with the type, or a bare zpub; the fingerprint hides the key', () => {
		assert.equal(parseStoredKey(JSON.stringify({ key: XPUB44, type: 'p2pkh' })).type, 'p2pkh');
		assert.equal(parseStoredKey(ZPUB).type, 'p2wpkh');
		assert.match(keyFingerprint(ZPUB), /^btc-[0-9a-f]{8}$/);
		assert.notEqual(keyFingerprint(ZPUB), keyFingerprint(YPUB));
	});
});

// ---- a fake Esplora API ------------------------------------------------------

const z = parseExtendedKey(ZPUB);
const addr = (/** @type {0 | 1} */ chain, /** @type {number} */ i) =>
	deriveAddress(z.account, z.type, chain, i);
const R0 = addr(0, 0);
const R1 = addr(0, 1);
const R2 = addr(0, 2);
const R3 = addr(0, 3);
const C0 = addr(1, 0);
// Made-up addresses of others (not ours; the format is what matters).
const X = 'bc1qexternalsenderxxxxxxxxxxxxxxxxxxxxxxxxx';
const Y = 'bc1qexternalreceiveryyyyyyyyyyyyyyyyyyyyyyy';
const W = 'bc1qexternalwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww';
const FOREIGN = 'bc1qforeigninputzzzzzzzzzzzzzzzzzzzzzzzzzz';

/** @param {string} txid @param {number} height @param {[string, number][]} ins @param {[string, number][]} outs @param {number} fee @param {boolean} [confirmed] */
const tx = (txid, height, ins, outs, fee, confirmed = true) => ({
	txid,
	status: { confirmed, block_height: height, block_time: 1_788_000_000 + height * 600 },
	fee,
	vin: ins.map(([a, value]) => ({ prevout: { scriptpubkey_address: a, value } })),
	vout: outs.map(([a, value]) => ({ scriptpubkey_address: a, value }))
});

const hex = (/** @type {number} */ n) => n.toString(16).padStart(64, '0');
const TXS = [
	tx(hex(1), 100, [[X, 1_010_000]], [[R0, 1_000_000]], 10_000), // received 0.01
	tx(
		hex(2),
		200,
		[[R0, 1_000_000]],
		[
			[Y, 300_000],
			[C0, 690_000]
		],
		10_000
	), // sent 0.003, change, fee
	tx(hex(3), 300, [[C0, 690_000]], [[R1, 685_000]], 5_000), // to ourselves: only the fee
	tx(
		hex(4),
		400,
		[
			[R1, 685_000],
			[FOREIGN, 100_000]
		],
		[
			[W, 500_000],
			[R2, 283_000]
		],
		2_000
	), // mixed
	tx(hex(5), 450, [[X, 60_000]], [[R2, 50_000]], 10_000, false), // unconfirmed: not booked
	// 30 small payments to R3: more than one page of 25
	...Array.from({ length: 30 }, (_, i) =>
		tx(hex(100 + i), 500 + i, [[X, 2_000]], [[R3, 1_000]], 1_000)
	)
];

/** @param {string[]} [asked] */
function fakeEsplora(asked = []) {
	/** @type {typeof fetch} */
	return async (input) => {
		const url = new URL(String(input));
		asked.push(url.pathname);
		const m = /^\/api\/address\/([^/]+)(\/txs\/chain(?:\/([0-9a-f]+))?)?$/.exec(url.pathname);
		if (!m) return new Response('{}', { status: 404 });
		const a = m[1];
		const touches = (/** @type {any} */ t) =>
			t.vin.some((/** @type {any} */ i) => i.prevout.scriptpubkey_address === a) ||
			t.vout.some((/** @type {any} */ o) => o.scriptpubkey_address === a);
		const mine = TXS.filter(touches);
		if (!m[2]) {
			const conf = mine.filter((t) => t.status.confirmed);
			const funded = conf.flatMap((t) => t.vout).filter((o) => o.scriptpubkey_address === a);
			const spent = conf.flatMap((t) => t.vin).filter((i) => i.prevout.scriptpubkey_address === a);
			return Response.json({
				address: a,
				chain_stats: {
					tx_count: conf.length,
					funded_txo_sum: funded.reduce((s, o) => s + o.value, 0),
					spent_txo_sum: spent.reduce((s, i) => s + i.prevout.value, 0)
				},
				mempool_stats: { tx_count: mine.length - conf.length }
			});
		}
		// Newest first, 25 a page, continued after the last txid seen.
		const conf = mine.filter((t) => t.status.confirmed).reverse();
		const from = m[3] ? conf.findIndex((t) => t.txid === m[3]) + 1 : 0;
		return Response.json(conf.slice(from, from + 25));
	};
}

describe('a wallet’s history', () => {
	test('entries from our point of view: received, sent with fee, to ourselves, mixed inputs', () => {
		const own = new Set([R0, R1, R2, R3, C0]);
		const entries = normalizeBitcoin(TXS.filter((t) => t.status.confirmed).slice(0, 4), own, BTC);
		assert.deepEqual(
			entries.map((e) => [e.id.slice(-8), e.type, e.amount, e.counterparty]),
			[
				['01:value', 'received', '0.01', X],
				['02:value', 'sent', '-0.003', Y],
				['0002:fee', 'fee', '-0.0001', ''],
				['0003:fee', 'fee', '-0.00005', ''],
				['04:value', 'sent', '-0.00402', W]
			]
		);
		assert.match(entries[4].memo, /several wallets/);
		assert.ok(entries.every((e) => e.asset === 'BTC' && e.decimals === 8 && e.hash.length === 64));
		assert.equal(entries[0].explorerUrl, `https://mempool.space/tx/${hex(1)}`);
	});

	test('sync: derives until 20 unused in a row, reads every page, books only confirmed, balance', async () => {
		/** @type {string[]} */ const asked = [];
		const wallets = createWalletService({
			fetch: fakeEsplora(asked),
			allowLoopback: true,
			getZpub: async () => JSON.stringify({ key: ZPUB, type: 'p2wpkh' }),
			bitcoinPauseMs: 0
		});
		assert.equal(await wallets.bitcoinKey(), keyFingerprint(ZPUB));
		const result = await wallets.sync({
			chain: 'bitcoin',
			address: keyFingerprint(ZPUB),
			endpoints: { api: 'http://127.0.0.1:1/api' }
		});
		// receive R0–R3 used + 20 unused; change C0 used + 20 unused
		assert.deepEqual(result.addresses, { used: 5, derived: 24 + 21 });
		assert.equal(result.transactions, 4 + 30);
		assert.equal(result.entries.filter((e) => e.id.includes(hex(5))).length, 0, 'unconfirmed');
		assert.equal(result.entries.filter((e) => e.amount === '0.00001').length, 30, 'both pages');
		// what is left: R2 283 000 + R3 30 × 1 000 sats
		assert.deepEqual(result.balances, [{ asset: 'BTC', amount: '0.00313', decimals: 8 }]);
		assert.ok(
			asked.some((p) => /\/txs\/chain\/[0-9a-f]{64}$/.test(p)),
			'the second page'
		);
	});

	test('a replaced key or none: refused, not booked onto the old account', async () => {
		const wallets = createWalletService({
			fetch: fakeEsplora(),
			allowLoopback: true,
			getZpub: async () => YPUB,
			bitcoinPauseMs: 0
		});
		await assert.rejects(
			wallets.sync({ chain: 'bitcoin', address: keyFingerprint(ZPUB), endpoints: {} }),
			(e) => /** @type {any} */ (e).code === 'WALLET_KEY_CHANGED'
		);
		const none = createWalletService({ fetch: fakeEsplora(), getZpub: async () => null });
		assert.equal(await none.bitcoinKey(), null);
		await assert.rejects(
			none.sync({ chain: 'bitcoin', address: 'btc-00000000', endpoints: {} }),
			(e) => /** @type {any} */ (e).code === 'WALLET_NOT_SET_UP'
		);
	});
});

describe('setup:bitcoin', () => {
	/** @param {string[]} answers @param {string[]} hidden */
	const io = (answers, hidden = []) => {
		/** @type {string[]} */ const out = [];
		return {
			out,
			io: {
				ask: async () => answers.shift() ?? '',
				askHidden: async () => hidden.shift() ?? '',
				print: (/** @type {string} */ l) => out.push(l)
			}
		};
	};

	test('an xpub asks for its type and is kept with it; only the fingerprint is printed', async () => {
		const keychain = memoryKeychain(null, 'bitcoin');
		const { io: prompts, out } = io(['2'], [XPUB44]);
		assert.equal(await runBitcoinSetup({ io: prompts, keychain }), keyFingerprint(XPUB44));
		assert.deepEqual(JSON.parse(await keychain.read()), { key: XPUB44, type: 'p2pkh' });
		assert.ok(
			out.every((l) => !l.includes(XPUB44)),
			'the key is never printed'
		);
		assert.ok(out.some((l) => l.includes('1… (legacy)')));
	});

	test('a zpub from .env when the person says yes; nonsense is not stored', async () => {
		const keychain = memoryKeychain(null, 'bitcoin');
		const { io: prompts, out } = io(['']);
		await runBitcoinSetup({ io: prompts, keychain, envValue: ZPUB });
		assert.equal(JSON.parse(await keychain.read()).type, 'p2wpkh');
		assert.ok(out.some((l) => /delete BITCOIN_XPUB/.test(l)));
		const empty = memoryKeychain(null, 'bitcoin');
		assert.equal(
			await runBitcoinSetup({ io: io([], ['zpub-nonsense']).io, keychain: empty }),
			null
		);
		await assert.rejects(empty.read());
	});
});
