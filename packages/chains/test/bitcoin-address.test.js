// SPDX-License-Identifier: AGPL-3.0-or-later
// One Bitcoin address read through Esplora (a fake, in memory): which
// addresses it takes, a receipt, a payment with its fee, a transfer between
// own addresses, a page boundary, the month's statement, errors that name no
// address.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HDKey } from '@scure/bip32';

import {
	BITCOIN,
	accountOf,
	isExtendedKey,
	isBitcoinAddress,
	probe,
	readBitcoin,
	statementBitcoin
} from '../src/bitcoin-address.js';
import { deriveAddress, keyFingerprint, parseExtendedKey } from '../src/bitcoin.js';
import { isDoichainAddress } from '../src/doichain.js';
import { CHAINS } from '../src/registry.js';
import { blockTime, btcTx, fakeBitcoinAddress, fakeEsplora } from './support/fake-esplora.js';
import { fakeDoichainAddress } from './support/fake-electrum.js';

const OURS = fakeBitcoinAddress('own address');
const SECOND = fakeBitcoinAddress('second own address', 'p2pkh');
const SHOP = fakeBitcoinAddress('a shop', 'p2sh');
const FRIEND = fakeBitcoinAddress('a customer', 'p2pkh');

const day = (/** @type {number} */ height) =>
	new Date(blockTime(height) * 1000).toISOString().slice(0, 10);

const txs = [
	// received 0.001 from a customer
	btcTx(
		'customer pays',
		300,
		[[FRIEND, 200_000]],
		[
			[OURS, 100_000],
			[FRIEND, 99_000]
		]
	),
	// paid a shop 0.0004, change back, 0.000012 fee
	btcTx(
		'we pay the shop',
		600,
		[[OURS, 100_000]],
		[
			[SHOP, 40_000],
			[OURS, 58_800]
		]
	),
	// moved 0.0002 to the second own address, 0.00001 fee
	btcTx(
		'to the second address',
		900,
		[[OURS, 58_800]],
		[
			[SECOND, 20_000],
			[OURS, 37_800]
		]
	),
	// still in the mempool: not booked
	btcTx('unconfirmed', 0, [[FRIEND, 50_000]], [[OURS, 49_000]])
];
const env = (/** @type {ReturnType<typeof fakeEsplora>} */ api) => ({
	fetch: api.fetch,
	endpoints: { api: api.url },
	sleep: async () => {}
});

test('Bitcoin addresses of every kind are taken; Doichain addresses and typos are not', () => {
	for (const a of [OURS, SECOND, SHOP]) assert.equal(isBitcoinAddress(a), true, a);
	// Taproot (bech32m), BIP350's test vector
	assert.equal(
		isBitcoinAddress('bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0'),
		true
	);
	assert.equal(isBitcoinAddress(fakeDoichainAddress('own address')), false);
	assert.equal(isDoichainAddress(OURS), false);
	assert.equal(isBitcoinAddress(`${OURS.slice(0, -1)}${OURS.endsWith('q') ? 'p' : 'q'}`), false);
	assert.equal(isBitcoinAddress(''), false);
	assert.equal(CHAINS.bitcoin, BITCOIN);
});

test('a receipt, a payment with the fee on its own, a transfer to an own address', async () => {
	const api = fakeEsplora({ txs });
	const entries = await readBitcoin({
		account: OURS,
		own: [SECOND],
		from: day(0),
		to: day(2000),
		...env(api)
	});
	const brief = entries.map((e) => [e.type, e.kind, e.amount, e.counterpartyLabel]);
	assert.deepEqual(brief, [
		['received', 'transfer', '0.001', ''],
		['sent', 'transfer', '-0.0004', ''],
		['fee', 'fee', '-0.000012', 'Bitcoin-Netzwerk (Miner-Gebühr)'],
		['sent', 'transfer', '-0.0002', 'eigene Adresse'],
		['fee', 'fee', '-0.00001', 'Bitcoin-Netzwerk (Miner-Gebühr)']
	]);
	assert.ok(entries.every((e) => e.chain === 'bitcoin' && e.asset === 'BTC'));
	assert.equal(entries[1].counterparty, SHOP);
	assert.match(entries[1].explorerUrl, /^https:\/\/mempool\.space\/tx\/[0-9a-f]{64}$/);
});

test('the statement derives its balances from today’s and reconciles', async () => {
	const api = fakeEsplora({ txs });
	const s = await statementBitcoin({
		account: OURS,
		from: day(600),
		to: day(900),
		...env(api)
	});
	assert.equal(s.opening.BTC, '0.001');
	assert.equal(s.closing.BTC, '0.000378');
	assert.equal(s.entries.length, 4);
});

test('more than one page of transactions is read to the end', async () => {
	const many = Array.from({ length: 60 }, (_, i) =>
		btcTx(`gift ${i}`, 100 + i * 200, [[FRIEND, 2_000]], [[OURS, 1_000]])
	);
	const api = fakeEsplora({ txs: many });
	const entries = await readBitcoin({ account: OURS, from: day(0), to: day(20_000), ...env(api) });
	assert.equal(entries.length, 60);
	assert.equal(api.calls.filter((c) => c.includes('/txs/chain')).length, 3);
});

test('a period reads back to its start only, not the whole history', async () => {
	const many = Array.from({ length: 100 }, (_, i) =>
		btcTx(`old gift ${i}`, 100 + i * 200, [[FRIEND, 2_000]], [[OURS, 1_000]])
	);
	const api = fakeEsplora({ txs: many });
	// the newest 30 gifts: heights 14 100 … 19 900
	const entries = await readBitcoin({
		account: OURS,
		from: day(14_100),
		to: day(20_000),
		...env(api)
	});
	assert.ok(entries.length >= 30);
	assert.equal(api.calls.filter((c) => c.includes('/txs/chain')).length, 2);

	const s = await statementBitcoin({
		account: OURS,
		from: day(14_100),
		to: day(20_000),
		...env(api)
	});
	assert.equal(s.closing.BTC, '0.001');
});

for (const as of /** @type {const} */ (['network', 503, 429])) {
	test(`an API that limits requests (${as}) is waited for, and read to the end`, async () => {
		const many = Array.from({ length: 60 }, (_, i) =>
			btcTx(`gift ${i}`, 100 + i * 200, [[FRIEND, 2_000]], [[OURS, 1_000]])
		);
		/** @type {number[]} */
		const waits = [];
		const api = fakeEsplora({ txs: many, throttle: { after: 2, times: 4, as, retryAfter: '7' } });
		const entries = await readBitcoin({
			account: OURS,
			from: day(0),
			to: day(20_000),
			...env(api),
			sleep: async (ms) => void waits.push(ms)
		});
		assert.equal(entries.length, 60);
		assert.ok(
			waits.some((ms) => ms >= 15_000),
			'a long pause after the refusals'
		);
		if (as !== 'network') assert.ok(waits.includes(7_000), 'Retry-After is honoured');
	});
}

test('an API that keeps refusing says it limits requests, not that it is not reachable', async () => {
	const many = Array.from({ length: 60 }, (_, i) =>
		btcTx(`gift ${i}`, 100 + i * 200, [[FRIEND, 2_000]], [[OURS, 1_000]])
	);
	const api = fakeEsplora({ txs: many, throttle: { after: 2, times: 1_000, as: 'network' } });
	await assert.rejects(
		readBitcoin({
			account: OURS,
			from: day(0),
			to: day(20_000),
			...env(api),
			sleep: async () => {}
		}),
		(/** @type {any} */ e) =>
			e.code === 'WALLET_RATE_LIMIT' &&
			/limits requests: try again in a few minutes/.test(e.message) &&
			!e.message.includes(OURS)
	);
});

test('an address it does not take, or an API that is down, says so without the address', async () => {
	await assert.rejects(
		readBitcoin({
			account: fakeDoichainAddress('x'),
			from: day(0),
			to: day(1),
			...env(fakeEsplora({ txs }))
		}),
		/not a valid Bitcoin address/
	);
	await assert.rejects(
		readBitcoin({
			account: OURS,
			from: day(0),
			to: day(1),
			...env(fakeEsplora({ txs, down: true }))
		}),
		(/** @type {Error} */ e) => !e.message.includes(OURS) && /not reachable/.test(e.message)
	);
});

// A wallet from a made-up seed: its zpub, and its receive and change addresses.
const ZPUB = HDKey.fromMasterSeed(
	Uint8Array.from({ length: 64 }, (_, i) => 255 - i),
	{
		private: 0x04b2430c,
		public: 0x04b24746
	}
).derive("m/84'/0'/0'").publicExtendedKey;
const wallet = parseExtendedKey(ZPUB);
const receive = (/** @type {number} */ i) => deriveAddress(wallet.account, wallet.type, 0, i);
const change = (/** @type {number} */ i) => deriveAddress(wallet.account, wallet.type, 1, i);

test('a wallet by its zpub: one account, change is no booking, the key never asked', async () => {
	const walletTxs = [
		// a customer pays to receive 0 and, later, to receive 3 (a gap below 20)
		btcTx('pays receive 0', 300, [[FRIEND, 200_000]], [[receive(0), 100_000]]),
		btcTx('pays receive 3', 500, [[FRIEND, 200_000]], [[receive(3), 50_000]]),
		// the wallet pays a shop from both, the change to change 0, fee 1 000
		btcTx(
			'wallet pays the shop',
			700,
			[
				[receive(0), 100_000],
				[receive(3), 50_000]
			],
			[
				[SHOP, 120_000],
				[change(0), 29_000]
			]
		)
	];
	const api = fakeEsplora({ txs: walletTxs });
	const s = await statementBitcoin({
		account: ZPUB,
		from: day(0),
		to: day(20_000),
		...env(api)
	});
	assert.equal(s.closing.BTC, '0.00029');
	const account = keyFingerprint(ZPUB);
	assert.ok(s.entries.every((e) => e.account === account));
	// two receipts, the payment to the shop and its fee; nothing for the change
	assert.equal(s.entries.length, 4);
	assert.ok(!s.entries.some((e) => e.counterparty === change(0)));
	assert.ok(s.entries.some((e) => e.counterparty === SHOP));
	// 20 unused after receive 3, 20 unused after change 0
	const asked = api.calls.filter((c) => /\/address\/[^/]+$/.test(c));
	assert.equal(asked.length, 24 + 21);
	assert.ok(api.calls.every((c) => !c.includes(ZPUB)));
	assert.equal(accountOf(ZPUB), account);
	assert.equal(accountOf(OURS), OURS);
});

test('extended keys are told apart from addresses; a private key is refused', async () => {
	assert.ok(isExtendedKey(ZPUB));
	assert.ok(!isExtendedKey(OURS));
	assert.ok(!isBitcoinAddress(ZPUB));
	const xprv = HDKey.fromMasterSeed(Uint8Array.from({ length: 64 }, (_, i) => i)).derive(
		"m/84'/0'/0'"
	).privateExtendedKey;
	await assert.rejects(
		readBitcoin({ account: xprv, from: day(0), to: day(1), ...env(fakeEsplora({ txs })) }),
		/not a valid Bitcoin address/
	);
	await assert.rejects(
		readBitcoin({
			account: ZPUB.slice(0, -1) + (ZPUB.endsWith('a') ? 'b' : 'a'),
			from: day(0),
			to: day(1),
			...env(fakeEsplora({ txs }))
		}),
		/checksum or length/
	);
});

test('the probe asks for the tip only', async () => {
	const api = fakeEsplora({ txs });
	assert.equal((await probe(env(api))).entries, 1);
	assert.deepEqual(api.calls, [`${api.url}/blocks/tip/height`]);
	await assert.rejects(probe(env(fakeEsplora({ txs, tip: 12 }))), /without a tip/);
});
