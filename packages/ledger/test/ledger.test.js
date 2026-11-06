// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	SCHEMA,
	derivedStatement,
	entry,
	fromUnits,
	fromWalletEntry,
	inPeriod,
	monthPeriod,
	multiply,
	round,
	sortEntries,
	sum,
	toUnits,
	unitsToDecimal
} from '../src/index.js';

// Made-up accounts and hashes throughout.
const base = {
	id: 'near:wolkenfabrik.near:H1:fee',
	chain: 'near',
	network: 'mainnet',
	account: 'wolkenfabrik.near',
	hash: 'H1',
	height: 1,
	time: '2026-10-05T12:00:00.000Z',
	type: /** @type {const} */ ('fee'),
	kind: /** @type {const} */ ('fee'),
	asset: 'NEAR',
	contract: 'native',
	decimals: 24,
	amount: '-0.000312',
	counterparty: 'near',
	counterpartyLabel: 'NEAR-Netzwerk',
	method: '',
	memo: '',
	success: true,
	explorerUrl: ''
};

test('units and decimals round-trip exactly, beyond float precision', () => {
	assert.equal(fromUnits(300545372466008700000000n, 24), '0.3005453724660087');
	assert.equal(fromUnits('-1', 24), '-0.000000000000000000000001');
	assert.equal(toUnits('0.000000000000000000000001', 24), 1n);
	assert.equal(toUnits('-12.34', 2), -1234n);
	assert.equal(fromUnits(0n, 6), '0');
	assert.equal(fromUnits(5n, 0), '5');
});

test("Belege's unitsToDecimal is fromUnits", () => {
	assert.equal(unitsToDecimal, fromUnits);
	assert.equal(unitsToDecimal(1_500_000n, 6), '1.5');
	assert.equal(unitsToDecimal(-1_000_000n, 6), '-1');
	assert.equal(unitsToDecimal(1n, 18), '0.000000000000000001');
});

test('sum and multiply round half away from zero', () => {
	assert.equal(sum(['0.1', '0.2', '-0.05']), '0.25');
	assert.equal(multiply('2.5', '3.8796'), '9.7');
	assert.equal(multiply('-0.000312', '3.8796', 4), '-0.0012');
	assert.equal(multiply('0.005', '1'), '0.01');
	assert.equal(multiply('-0.005', '1'), '-0.01');
	assert.equal(round('12.344999', 2), '12.34');
});

test('an entry is checked and gets its date and the schema', () => {
	const e = entry(base);
	assert.equal(e.schema, SCHEMA);
	assert.equal(e.schema, 'le-space.ledger/1');
	assert.equal(e.date, '2026-10-05');
	assert.throws(() => entry({ ...base, amount: '0.1' }), /must be negative/);
	assert.throws(() => entry({ ...base, kind: /** @type {any} */ ('gift') }), /bad kind/);
	assert.throws(() => entry({ ...base, amount: '1e-3' }), /bad amount/);
	assert.throws(() => entry({ ...base, schema: 'someone.else/2' }), /unknown schema/);
});

test("Eigenbeleg's eigenbeleg.ledger/1 entries are read as version 1", () => {
	const e = entry({ ...base, schema: 'eigenbeleg.ledger/1', priceAs: 'NEAR' });
	assert.equal(e.schema, 'le-space.ledger/1');
	assert.equal(e.priceAs, 'NEAR');
});

test('a WalletEntry with its context becomes a LedgerEntry', () => {
	/** @type {import('../src/wallet-entry.js').WalletEntry} */
	const w = {
		id: 'ABC:m0:e1.0:AKT',
		hash: 'ABC',
		height: 12,
		time: '2026-10-05T08:00:00Z',
		date: '2026-10-05',
		type: 'sent',
		kind: 'ibc',
		asset: 'AKT',
		amount: '-2.5',
		decimals: 6,
		counterparty: 'osmo1example',
		counterpartyLabel: '',
		memo: 'Konto A → Konto B',
		success: true,
		ibcMemo: '{"swap":true}',
		explorerUrl: 'https://example.com/tx/ABC'
	};
	const e = fromWalletEntry(w, { chain: 'akash', account: 'akash1own', priceAs: 'AKT' });
	assert.equal(e.id, 'akash:akash1own:ABC:m0:e1.0:AKT');
	assert.equal(e.kind, 'ibc');
	assert.equal(e.contract, 'native');
	assert.equal(e.priceAs, 'AKT');
	assert.equal(e.ibcMemo, '{"swap":true}');
	assert.equal('swap' in e, false);
	// A product reads some things its own way.
	assert.equal(
		fromWalletEntry(w, { chain: 'akash', account: 'a' }, { kind: 'transfer' }).kind,
		'transfer'
	);
	// An unlisted token is listed, never valued, and named by its contract.
	const spam = fromWalletEntry(
		{ ...w, type: 'received', kind: 'transfer', amount: '100', listed: false, contract: '0xdead' },
		{ chain: 'ethereum', account: '0xown', priceAs: 'ETH' }
	);
	assert.deepEqual([spam.contract, spam.priceAs, spam.listed], ['0xdead', '', false]);
});

test('sorting puts the fee after the payment of the same transaction', () => {
	const pay = entry({
		...base,
		id: 'near:H1:transfer',
		type: 'sent',
		kind: 'transfer',
		amount: '-1'
	});
	const fee = entry(base);
	assert.deepEqual(
		sortEntries([fee, pay]).map((e) => e.id),
		['near:H1:transfer', base.id]
	);
});

test('a month is its first to its last day; a period keeps both ends', () => {
	assert.deepEqual(monthPeriod('2026-02'), { from: '2026-02-01', to: '2026-02-28' });
	assert.deepEqual(monthPeriod('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
	assert.throws(() => monthPeriod('2026-13'));
	const days = ['2026-01-31', '2026-02-01', '2026-02-28', '2026-03-01'].map((date) => ({ date }));
	assert.deepEqual(inPeriod(days, '2026-02-01', '2026-02-28').length, 2);
});

test('balances derived from today less every movement since', () => {
	/** @param {string} id @param {string} date @param {string} amount */
	const mk = (id, date, amount) =>
		entry({
			...base,
			id,
			hash: id,
			time: `${date}T10:00:00Z`,
			type: amount.startsWith('-') ? 'sent' : 'received',
			kind: 'transfer',
			amount
		});
	const all = [mk('a', '2026-09-30', '5'), mk('b', '2026-10-10', '-2'), mk('c', '2026-11-03', '1')];
	const r = derivedStatement(all, [{ asset: 'NEAR', amount: '7' }], '2026-10-01', '2026-10-31');
	assert.deepEqual(
		[r.opening.NEAR, r.closing.NEAR, r.entries.map((e) => e.id), r.method],
		['8', '6', ['b'], 'derived']
	);
});
