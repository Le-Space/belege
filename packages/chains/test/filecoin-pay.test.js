// SPDX-License-Identifier: AGPL-3.0-or-later
// Filecoin Pay by the package alone: a month's statement from fakes of the
// makers' index, of Blockscout's log API and of Filfox – by each way the
// reader has – and its lines as ledger entries. Made-up payers, providers
// and amounts; the contract's own addresses are public.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	FILECOIN_PAY,
	createFilecoinPayClient,
	epochAt,
	epochTime,
	filecoinPayEntries,
	payerAddress
} from '../src/filecoin-pay.js';
import { toFilecoinAddress } from '../src/filecoin.js';
import { filecoinPayFetch } from './support/filecoin-pay-fetch.js';

const PAYER = `0x${'1a'.repeat(20)}`;
const OTHER = `0x${'2b'.repeat(20)}`;
const PROVIDER_A = `0x${'a1'.repeat(20)}`;
const PROVIDER_B = `0x${'b2'.repeat(20)}`;
const USDFC = FILECOIN_PAY.token.contract;
const WARM = Object.keys(FILECOIN_PAY.services)[0];
const SOMETHING = `0x${'cc'.repeat(20)}`;

/** A payer with two rails: paid in in July, settled in August and September. */
const events = () =>
	/** @type {import('./support/filecoin-pay-fetch.js').PayEvent[]} */ ([
		{ at: '2026-07-01T10:00:00Z', deposit: '10', token: USDFC, from: PAYER, to: PAYER },
		{
			at: '2026-07-01T10:05:00Z',
			rail: 7,
			payer: PAYER,
			payee: PROVIDER_A,
			token: USDFC,
			operator: WARM
		},
		{
			at: '2026-07-01T10:06:00Z',
			rail: 8,
			payer: PAYER,
			payee: PROVIDER_B,
			token: USDFC,
			operator: WARM
		},
		// Another payer's rail and settlement: never ours.
		{
			at: '2026-07-02T10:00:00Z',
			rail: 9,
			payer: OTHER,
			payee: PROVIDER_A,
			token: USDFC,
			operator: WARM
		},
		{
			at: '2026-08-05T08:00:00Z',
			settled: '5',
			railId: 9,
			toPayee: '5',
			commission: '0',
			fee: '0',
			upTo: '2026-08-05T00:00:00Z'
		},
		// A rail of ours in another token: not read.
		{
			at: '2026-07-03T10:00:00Z',
			rail: 10,
			payer: PAYER,
			payee: PROVIDER_A,
			token: SOMETHING,
			operator: WARM
		},
		{
			at: '2026-08-06T08:00:00Z',
			settled: '3',
			railId: 10,
			toPayee: '3',
			commission: '0',
			fee: '0',
			upTo: '2026-08-06T00:00:00Z'
		},
		{
			at: '2026-08-03T09:00:00Z',
			settled: '1.2',
			railId: 7,
			toPayee: '1.19',
			commission: '0',
			fee: '0.01',
			upTo: '2026-08-03T00:00:00Z'
		},
		{
			at: '2026-08-20T09:00:00Z',
			settled: '0.5',
			railId: 8,
			toPayee: '0.5',
			commission: '0',
			fee: '0',
			upTo: '2026-08-19T00:00:00Z'
		},
		// Paid up already: a settlement that moved nothing is no line.
		{
			at: '2026-08-21T09:00:00Z',
			settled: '0',
			railId: 8,
			toPayee: '0',
			commission: '0',
			fee: '0',
			upTo: '2026-08-19T00:00:00Z'
		},
		{ at: '2026-08-22T12:00:00Z', oneTime: '0.3', railId: 7 },
		{ at: '2026-08-25T12:00:00Z', deposit: '4', token: USDFC, from: OTHER, to: PAYER },
		{ at: '2026-08-28T12:00:00Z', withdraw: '1', token: USDFC, from: PAYER, to: PAYER },
		{
			at: '2026-09-02T09:00:00Z',
			settled: '0.7',
			railId: 7,
			toPayee: '0.7',
			commission: '0',
			fee: '0',
			upTo: '2026-09-01T00:00:00Z'
		}
	]);

/** The fake of all three sources. @param {Partial<Parameters<typeof filecoinPayFetch>[0]>} [more] */
const sources = (more = {}) =>
	filecoinPayFetch({
		contract: FILECOIN_PAY.contract,
		events: events(),
		funds: { [PAYER]: '10.3' },
		token: USDFC,
		toFilecoin: toFilecoinAddress,
		...more
	});

// 10 − 1.2 − 0.5 − 0.3 + 4 − 1 − 0.7 = 10.3 now.
/** @param {Record<string, unknown>} [more] @param {Partial<Parameters<typeof filecoinPayFetch>[0]>} [fake] */
const client = (more = {}, fake = {}) =>
	createFilecoinPayClient({
		fetch: sources(fake),
		sleep: async () => {},
		pauseMs: 0,
		rates: { rate: async () => ({ rate: '0.9', source: 'coingecko' }) },
		now: () => new Date('2026-09-10T00:00:00Z'),
		...more
	});

test('a month: opening + paid in − taken out − settled = closing, each settlement a line', async () => {
	const s = await client().statement({ address: PAYER, month: '2026-08' });
	assert.equal(s.opening, '10');
	assert.equal(s.closing, '11');
	assert.deepEqual(s.totals, { deposits: '4', withdrawals: '1', usage: '2', eurCents: 180 });
	assert.deepEqual(
		s.usage.map((u) => [u.date, u.railId, u.payee, u.service, u.amount, u.networkFee, u.oneTime]),
		[
			['2026-08-03', '7', PROVIDER_A, 'Filecoin Warm Storage', '1.2', '0.01', false],
			['2026-08-20', '8', PROVIDER_B, 'Filecoin Warm Storage', '0.5', '0', false],
			['2026-08-22', '7', PROVIDER_A, 'Filecoin Warm Storage', '0.3', '0', true]
		]
	);
	// Up to when a settlement paid; a one-time payment covers no time.
	assert.equal(s.usage[0].paidUntil, '2026-08-03T00:00:00.000Z');
	assert.equal(s.usage[2].paidUntil, null);
	assert.deepEqual([s.usage[0].eurPerUnit, s.usage[0].eurCents], ['0.9', 108]);
	assert.deepEqual(s.deposits, [
		{ time: '2026-08-25T12:00:00.000Z', amount: '4', other: OTHER, txHash: s.deposits[0].txHash }
	]);
	assert.equal(s.withdrawals[0].amount, '1');
	// The rails the month used, of the two the payer has in USDFC.
	assert.deepEqual(Object.keys(s.rails), ['7', '8']);
	assert.equal(s.railCount, 2);
	assert.deepEqual(
		[s.asset, s.address, s.filecoinAddress],
		['USDFC', PAYER, toFilecoinAddress(PAYER)]
	);
	assert.equal(s.now.funds, '10.3');
});

test('the month before and the month after hang together', async () => {
	const july = await client().statement({ address: PAYER, month: '2026-07' });
	const september = await client().statement({ address: PAYER, month: '2026-09' });
	assert.deepEqual([july.opening, july.closing], ['0', '10']);
	assert.deepEqual([september.opening, september.closing], ['11', '10.3']);
	assert.equal(september.totals.usage, '0.7');
});

test('the payer may be given as f410f…; what is no contract account is refused before anything is asked', async () => {
	const s = await client().statement({ address: toFilecoinAddress(PAYER), month: '2026-08' });
	assert.equal(s.address, PAYER);
	assert.equal(payerAddress('f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za'), null);
	assert.equal(payerAddress('not an address'), null);
	const f = filecoinPayFetch({ contract: FILECOIN_PAY.contract, events: [], funds: {} });
	const c = createFilecoinPayClient({ fetch: f, sleep: async () => {}, pauseMs: 0 });
	await assert.rejects(c.statement({ address: 'f0123', month: '2026-08' }), {
		code: 'FILPAY_ADDRESS'
	});
	await assert.rejects(c.statement({ address: PAYER, month: '2026-8' }), { code: 'FILPAY_MONTH' });
	await assert.rejects(c.statement({ address: PAYER, month: '2099-01' }), { code: 'FILPAY_MONTH' });
	assert.deepEqual(f.calls, []);
});

test('a payer without rails: nothing settled, and the long lists are not asked for', async () => {
	const f = filecoinPayFetch({
		contract: FILECOIN_PAY.contract,
		events: [{ at: '2026-08-02T10:00:00Z', deposit: '2', token: USDFC, from: OTHER, to: OTHER }],
		funds: { [OTHER]: '2' },
		token: USDFC,
		toFilecoin: toFilecoinAddress
	});
	const s = await createFilecoinPayClient({
		fetch: f,
		sleep: async () => {},
		pauseMs: 0,
		now: () => new Date('2026-09-10T00:00:00Z')
	}).statement({ address: OTHER, month: '2026-08' });
	assert.deepEqual([s.opening, s.closing, s.totals.usage, s.totals.eurCents], ['0', '2', '0', 0]);
	// The balance, the rails, and what was paid in and taken out: no list of settlements.
	assert.deepEqual(
		f.calls.map((c) => c.split(' ').slice(0, 2).join(' ')),
		['index userTokens', 'index rails', 'getLogs 0x0dc0013c', 'getLogs 0x332e20fb']
	);
});

test('more events than one answer holds are read on from its last block, each once', async () => {
	const many = events();
	for (let i = 0; i < 25; i++) {
		many.push({
			at: `2026-08-${String(10 + (i % 9)).padStart(2, '0')}T0${i % 9}:00:00Z`,
			settled: '0.01',
			railId: 9,
			toPayee: '0.01',
			commission: '0',
			fee: '0',
			upTo: '2026-08-09T00:00:00Z'
		});
	}
	const f = filecoinPayFetch({
		contract: FILECOIN_PAY.contract,
		events: many,
		funds: { [PAYER]: '10.3' },
		perPage: 10
	});
	const s = await createFilecoinPayClient({
		fetch: f,
		sleep: async () => {},
		pauseMs: 0,
		perPage: 10,
		now: () => new Date('2026-09-10T00:00:00Z')
	}).statement({ address: PAYER, month: '2026-08', source: 'logs' });
	assert.equal(s.totals.usage, '2');
	assert.equal(s.closing, '11');
	// And a history too long for the pages allowed is refused, not cut.
	await assert.rejects(
		createFilecoinPayClient({
			fetch: f,
			sleep: async () => {},
			pauseMs: 0,
			maxPages: 2,
			perPage: 10,
			now: () => new Date('2026-09-10T00:00:00Z')
		}).statement({ address: PAYER, month: '2026-08', source: 'logs' }),
		{ code: 'FILPAY_TOO_MANY' }
	);
});

test('by the index first; by the contract’s events when the index does not answer – the same statement', async () => {
	const lines = (/** @type {any} */ s) => ({
		opening: s.opening,
		closing: s.closing,
		totals: s.totals,
		usage: s.usage.map((/** @type {any} */ u) => [
			u.date,
			u.railId,
			u.amount,
			u.networkFee,
			u.paidUntil
		]),
		deposits: s.deposits.map((/** @type {any} */ d) => [d.time, d.amount, d.other]),
		withdrawals: s.withdrawals.map((/** @type {any} */ w) => [w.time, w.amount])
	});
	const byIndex = await client().statement({ address: PAYER, month: '2026-08' });
	assert.deepEqual(
		[byIndex.source, byIndex.indexFailed, byIndex.movementsFrom],
		['index', null, 'events']
	);

	const f = sources({ down: { index: true } });
	const byLogs = await client({ fetch: f }).statement({ address: PAYER, month: '2026-08' });
	assert.deepEqual([byLogs.source, byLogs.indexFailed], ['logs', 'WALLET_NODE']);
	assert.deepEqual(lines(byLogs), lines(byIndex));
	// Asked for by name, the index's failure is said, not passed over.
	await assert.rejects(
		client({ fetch: sources({ down: { index: true } }) }).statement({
			address: PAYER,
			month: '2026-08',
			source: 'index'
		})
	);
});

test('without Blockscout, paid in and taken out are the payer’s own transfers – and the statement says so', async () => {
	const s = await client({}, { down: { blockscout: true } }).statement({
		address: PAYER,
		month: '2026-08'
	});
	assert.deepEqual([s.source, s.movementsFrom], ['index', 'transfers']);
	// The 4 another address paid into the balance are not among the payer's transfers:
	// nothing paid in, and the opening balance is off by them.
	assert.deepEqual([s.totals.deposits, s.totals.withdrawals, s.totals.usage], ['0', '1', '2']);
	assert.deepEqual([s.opening, s.closing], ['14', '11']);
	// A transfer is known by its message, not by a transaction's hash.
	assert.match(s.withdrawals[0].txHash, /^bafy2bzace/);
	assert.match(
		filecoinPayEntries(s).at(-1)?.explorerUrl ?? '',
		/^https:\/\/filfox\.info\/en\/message\/bafy/
	);
});

test('with a key, Blockscout is asked through its one host for every chain', async () => {
	/** @type {string[]} */
	const asked = [];
	const inner = sources({ down: { index: true } });
	const f = /** @type {typeof fetch} */ (
		async (input, init) => {
			const url = new URL(String(input));
			asked.push(
				`${url.origin}${url.pathname}?chain_id=${url.searchParams.get('chain_id')}&apikey=${url.searchParams.get('apikey')}&module=${url.searchParams.get('module')}`
			);
			// The fake answers the instance's paths: the keyed host's are mapped onto them.
			if (url.hostname !== 'api.blockscout.com') return inner(input, init);
			if (url.searchParams.get('module') === 'proxy') {
				return inner('https://filecoin.blockscout.com/api/eth-rpc', {
					method: 'POST',
					body: JSON.stringify({ params: [{ data: url.searchParams.get('data') }] })
				});
			}
			return inner(`https://filecoin.blockscout.com/api?${url.searchParams}`, init);
		}
	);
	const s = await client({ fetch: f }).statement({
		address: PAYER,
		month: '2026-08',
		endpoints: { blockscoutKey: 'proapi_made_up' }
	});
	assert.deepEqual([s.source, s.closing], ['logs', '11']);
	const keyed = asked.filter((a) => a.startsWith('https://api.blockscout.com'));
	assert.ok(keyed.length >= 5);
	assert.ok(keyed.every((a) => a.includes('/v2/api?chain_id=314&apikey=proapi_made_up')));
	assert.ok(keyed.some((a) => a.endsWith('module=proxy')));
	assert.ok(!asked.some((a) => a.startsWith('https://filecoin.blockscout.com')));
});

test('as ledger entries: paid in, taken out and each settlement, signed from the balance', async () => {
	const s = await client().statement({ address: PAYER, month: '2026-08' });
	const entries = filecoinPayEntries(s);
	assert.deepEqual(
		entries.map((e) => [e.date, e.type, e.kind, e.amount, e.counterparty]),
		[
			['2026-08-03', 'sent', 'usage', '-1.2', PROVIDER_A],
			['2026-08-20', 'sent', 'usage', '-0.5', PROVIDER_B],
			['2026-08-22', 'sent', 'usage', '-0.3', PROVIDER_A],
			['2026-08-25', 'received', 'transfer', '4', OTHER],
			['2026-08-28', 'sent', 'transfer', '-1', PAYER]
		]
	);
	const first = entries[0];
	assert.deepEqual(
		[first.chain, first.asset, first.decimals, first.contract, first.priceAs],
		['filecoin-pay', 'USDFC', 18, USDFC, 'USDC']
	);
	assert.equal(first.counterpartyLabel, 'Filecoin Warm Storage (Rail 7)');
	assert.equal(first.memo, 'bezahlt bis 2026-08-03');
	assert.deepEqual(first.unitPrice, { currency: 'EUR', amount: '0.9', source: 'coingecko' });
	assert.match(first.explorerUrl, /^https:\/\/filecoin\.blockscout\.com\/tx\/0x[0-9a-f]{64}$/);
	assert.equal(entries.at(-1)?.counterpartyLabel, 'Auszahlung aus Filecoin Pay');
	assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);
});

test('an epoch is thirty seconds from Filecoin’s beginning', () => {
	// Checked against a block of the chain: 5 882 890 at 1 774 793 100.
	assert.equal(epochAt(1774793100), 5882890);
	assert.equal(epochTime(5882890), new Date(1774793100 * 1000).toISOString());
});
