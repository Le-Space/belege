// SPDX-License-Identifier: AGPL-3.0-or-later
// One Bitcoin address read through Esplora (a fake, in memory): which
// addresses it takes, a receipt, a payment with its fee, a transfer between
// own addresses, a page boundary, the month's statement, errors that name no
// address.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	BITCOIN,
	isBitcoinAddress,
	probe,
	readBitcoin,
	statementBitcoin
} from '../src/bitcoin-address.js';
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

test('the probe asks for the tip only', async () => {
	const api = fakeEsplora({ txs });
	assert.equal((await probe(env(api))).entries, 1);
	assert.deepEqual(api.calls, [`${api.url}/blocks/tip/height`]);
	await assert.rejects(probe(env(fakeEsplora({ txs, tip: 12 }))), /without a tip/);
});
