// SPDX-License-Identifier: AGPL-3.0-or-later
// A wallet's network fees on its statement (#1044): one collective line per
// month from two fees on, every fee in the annex and in the CSV, the running
// balance exact. Made-up wallet, hashes and amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';

import { entry, sortEntries } from '@le-space/ledger';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import {
	buildDocument,
	buildStatement,
	eigenbelegCsv,
	feeGroupLabel,
	fixedRates,
	statementPdf,
	valueEntries
} from '../src/index.js';

const payer = { name: 'Wolkenfabrik Hosting GmbH', address: 'Musterstraße 1\n12345 Beispielstadt' };
const WALLET = 'akash1wolkenfabrik000000000000000000000000';
const OTHER = 'akash1stromwerk0000000000000000000000000000';
const issuedAt = '2026-11-02T08:00:00.000Z';

/** A made-up 64-digit hash, distinct per n. @param {number} n */
const hash = (n) => n.toString(16).toUpperCase().padStart(4, '0').repeat(16);

const base = {
	chain: 'akash',
	network: 'mainnet',
	account: WALLET,
	height: 1,
	contract: 'native',
	asset: 'AKT',
	priceAs: 'AKT',
	decimals: 6,
	counterpartyLabel: '',
	method: '',
	memo: '',
	success: true
};

/** A fee of 0.005 AKT: at the fixed 2 EUR per AKT, 0,01 €. @param {number} n @param {string} time */
const fee = (n, time) =>
	entry({
		...base,
		id: `akash:${WALLET}:fee${n}`,
		hash: hash(n),
		height: n,
		time,
		type: 'fee',
		kind: 'fee',
		amount: '-0.005',
		counterparty: 'akash',
		counterpartyLabel: 'Akash-Netzwerk',
		explorerUrl: `https://explorer.example.com/tx/${hash(n)}`
	});

/** 1 AKT sent to another account. @param {number} n @param {string} time */
const sent = (n, time) =>
	entry({
		...base,
		id: `akash:${WALLET}:send${n}`,
		hash: hash(n),
		height: n,
		time,
		type: 'sent',
		kind: 'transfer',
		amount: '-1',
		counterparty: OTHER,
		explorerUrl: `https://explorer.example.com/tx/${hash(n)}`
	});

/** `2026-09-dd` at hh:mm UTC. @param {string} month @param {number} day @param {number} [hour] */
const at = (month, day, hour = 10) =>
	`${month}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

/** @param {import('@le-space/ledger').LedgerEntry[]} entries */
const valued = (entries) => valueEntries(entries, fixedRates({ AKT: '2' }));

/** @param {import('@le-space/ledger').LedgerEntry[]} entries @param {Partial<Parameters<typeof buildStatement>[0]>} [over] */
const statement = async (entries, over = {}) => {
	const total = entries.reduce((n, e) => n + Number(e.amount), 0);
	return buildStatement({
		payer,
		account: WALLET,
		chain: 'akash',
		network: 'mainnet',
		period: { from: '2026-09-01', to: '2026-09-30' },
		entries: await valued(entries),
		opening: { AKT: '10' },
		closing: { AKT: String(Math.round((10 + total) * 1e6) / 1e6) },
		method: 'derived',
		number: 'KA-2026-09',
		issuedAt,
		...over
	});
};

/** @param {Uint8Array} bytes */
const textOf = async (bytes) =>
	/** @type {string[]} */ ((await extractText(await getDocumentProxy(bytes.slice()))).text)
		.join('\n')
		.replace(/\s+/g, ' ');

// 27 fees in September, one a day from the 1st, and a transfer on the 10th between them.
const september = sortEntries([
	...Array.from({ length: 27 }, (_, i) => fee(i + 1, at('2026-09', i + 1))),
	sent(100, at('2026-09', 10, 12))
]);

test('a month with many fees: one collective line, dated on the last fee, the annex lists each', async () => {
	const st = await statement(september);
	assert.equal(st.collectFees, true);
	const [s] = st.sections;
	assert.equal(s.rows.length, 28, 'the rows keep every fee');
	assert.equal(s.rows.filter((r) => r.group === 'NG-2026-09-AKT').length, 27);
	assert.equal(feeGroupLabel('2026-09', 'AKT'), 'NG-2026-09-AKT');
	assert.deepEqual(
		s.lines.map((r) => [r.date, r.text, r.debit, r.balance, r.eur]),
		[
			['2026-09-10', 'Überweisung', '1', '9', '-2'],
			['2026-09-27', 'Netzwerkgebühren · 27 Transaktionen · −0,27 €', '0.135', '8.865', '-0.27']
		]
	);
	assert.equal(s.closing, '8.865');
	assert.equal(s.lines.at(-1)?.balance, s.closing, 'the table ends on the closing balance');
	assert.deepEqual(
		s.feeGroups.map((g) => [g.label, g.month, g.count, g.amount, g.eur, g.rows.length]),
		[['NG-2026-09-AKT', '2026-09', 27, '0.135', '-0.27', 27]]
	);
	// The sums are those of every booking, collected or not.
	assert.equal(s.eurFees, '0.27');
	assert.equal(s.monthly.fees?.rows, 27);

	const pdf = await statementPdf(st);
	assert.deepEqual(pdfaStructure(pdf).pdfaid, { part: '2', conformance: 'B' });
	const text = await textOf(pdf);
	for (const expected of [
		'Netzwerkgebühren · 27 Transaktionen · −0,27 €',
		'Sammelposten NG-2026-09-AKT · jede Gebühr im Anhang',
		'Anhang: Netzwerkgebühren',
		'NG-2026-09-AKT · AKT · 27 Transaktionen · 0,135 AKT · −0,27 €',
		'27.09.2026 10:00:00',
		hash(1),
		hash(27)
	])
		assert.ok(text.includes(expected), expected);
	assert.ok(!text.includes('Akash-Netzwerk · akash'), 'no single fee line in the main table');

	const en = await textOf(await statementPdf(await statement(september, { language: 'en' })));
	for (const expected of [
		'Network fees · 27 transactions · −0.27 EUR',
		'Collective line NG-2026-09-AKT · each fee in the annex',
		'Annex: network fees'
	])
		assert.ok(en.includes(expected), expected);
});

test('the CSV keeps every fee, naming its collective line', async () => {
	const entries = await valued(september);
	const doc = buildDocument({
		payer: { ...payer, addresses: [WALLET] },
		chain: 'akash',
		network: 'mainnet',
		period: { from: '2026-09-01', to: '2026-09-30' },
		entries,
		number: 'EB-2026-09',
		issuedAt
	});
	const rows = eigenbelegCsv(doc)
		.replace(/^﻿/, '')
		.split('\r\n')
		.map((r) => r.split(';'));
	assert.equal(rows[0].at(-1), 'Sammelposten');
	const fees = rows.filter((r) => r[16]?.length === 64 && r[16] !== hash(100));
	assert.equal(fees.length, 27, 'a line per fee');
	assert.ok(fees.every((r) => r.at(-1) === 'NG-2026-09-AKT'));
	assert.equal(rows.find((r) => r[16] === hash(100))?.at(-1), '', 'the transfer is in no group');
	// Switched off: the column stays, empty.
	const off = eigenbelegCsv(doc, { collectFees: false }).split('\r\n');
	assert.ok(off.slice(1).every((r) => !r.includes('NG-2026-09-AKT')));
});

test('a single fee stays a line of its own', async () => {
	const st = await statement([fee(1, at('2026-09', 3)), sent(100, at('2026-09', 10))]);
	const [s] = st.sections;
	assert.deepEqual(s.feeGroups, []);
	assert.equal(s.rows[0].group, '');
	assert.deepEqual(s.lines, s.rows);
	const text = await textOf(await statementPdf(st));
	assert.ok(text.includes('Netzwerkgebühr'));
	assert.ok(!text.includes('Anhang: Netzwerkgebühren'));
	assert.ok(!text.includes('Sammelposten'));
});

test('fees across a month boundary: one collective line per month; a lone fee stays a line', async () => {
	const st = await statement(
		[
			fee(1, at('2026-09', 28)),
			fee(2, at('2026-09', 29)),
			fee(3, at('2026-09', 30, 23)),
			fee(4, at('2026-10', 1, 0)),
			fee(5, at('2026-10', 2)),
			fee(6, at('2026-11', 1))
		],
		{ period: { from: '2026-09-15', to: '2026-11-14' } }
	);
	const [s] = st.sections;
	assert.deepEqual(
		s.lines.map((r) => [r.date, r.group, r.text, r.balance]),
		[
			['2026-09-30', 'NG-2026-09-AKT', 'Netzwerkgebühren · 3 Transaktionen · −0,03 €', '9.985'],
			['2026-10-02', 'NG-2026-10-AKT', 'Netzwerkgebühren · 2 Transaktionen · −0,02 €', '9.975'],
			['2026-11-01', '', 'Netzwerkgebühr (Gas)', '9.97']
		]
	);
	assert.deepEqual(
		s.feeGroups.map((g) => [g.label, g.count]),
		[
			['NG-2026-09-AKT', 3],
			['NG-2026-10-AKT', 2]
		]
	);
});

test('the balance is the same with and without collecting', async () => {
	const on = await statement(september);
	const off = await statement(september, { collectFees: false });
	const [a] = on.sections;
	const [b] = off.sections;
	assert.equal(off.collectFees, false);
	assert.deepEqual(b.feeGroups, []);
	assert.deepEqual(b.lines, b.rows, 'switched off: the old layout, a line per fee');
	assert.ok(b.rows.every((r) => r.group === ''));
	for (const k of /** @type {const} */ (['closing', 'debit', 'credit', 'eurOut', 'eurFees']))
		assert.equal(a[k], b[k], k);
	assert.equal(a.lines.at(-1)?.balance, b.rows.at(-1)?.balance);
	// Every line's balance is the one above it plus the line.
	let balance = 10;
	for (const r of a.lines) {
		balance = Math.round((balance - Number(r.debit || 0) + Number(r.credit || 0)) * 1e6) / 1e6;
		assert.equal(Number(r.balance), balance, r.text);
	}
	const text = await textOf(await statementPdf(off));
	assert.ok(!text.includes('Anhang: Netzwerkgebühren'));
	assert.ok(!text.includes('Sammelposten'));
});
