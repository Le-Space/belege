// SPDX-License-Identifier: AGPL-3.0-or-later
// Aleph credits as a Verbrauchsauszug, and the statement layout Belege draws
// its statement Eigenbelege with. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import {
	ALEPH_NOTE,
	USAGE_NOTE,
	buildStatement,
	eigenbelegCsv,
	eigenbelegPdf,
	buildDocument,
	monthly,
	statementPdf
} from '../src/index.js';
import { alephEntries, alephPurchaseEntries, payer, sheet } from './support/samples.js';

/** @param {Uint8Array} bytes */
const pages = async (bytes) =>
	/** @type {string[]} */ ((await extractText(await getDocumentProxy(bytes.slice()))).text);

test('Aleph credits: a Verbrauchsauszug, valued at the purchase price and the day’s USD rate', async () => {
	const entries = await alephEntries();
	const [, storage] = entries;
	// 200 credits × 0.000002 USD × 0.8 EUR/USD.
	assert.deepEqual(storage.eur, {
		value: '-0.00032',
		rate: '0.0000016',
		source: 'Aleph Kaufpreis 0.000002 USD je Credit × fester Testkurs (USD)'
	});
	const st = buildStatement({
		payer,
		account: entries[0].account,
		chain: 'aleph',
		network: 'mainnet',
		period: { from: '2026-08-01', to: '2026-08-31' },
		entries,
		opening: { 'ALEPH-CREDIT': '2000000' },
		closing: { 'ALEPH-CREDIT': '2997800' },
		method: 'derived',
		number: 'VA-2026-08-01',
		issuedAt: '2026-09-01T08:00:00.000Z'
	});
	assert.equal(st.title, 'Verbrauchsauszug');
	assert.equal(st.note, USAGE_NOTE);
	const [s] = st.sections;
	assert.equal(s.closing, '2997800');
	assert.deepEqual(
		s.rows.map((r) => [r.hashLabel, r.usage]),
		[
			['Tx', false],
			['Ressource', true],
			['Ressource', true]
		]
	);
	assert.equal(s.eurUsage, '0.00352');
	const text = (await pages(await statementPdf(st))).join('\n').replace(/\s+/g, ' ');
	for (const expected of [
		'Verbrauchsauszug',
		'Auszug-Nr. VA-2026-08-01',
		'Aleph Cloud (Credits) (mainnet)',
		'davon Verbrauch (Aufwand) 0,00 €',
		'Daten: Aleph-API (api2.aleph.im)',
		'Seite 1 von 1'
	])
		assert.ok(text.includes(expected), expected);
	// Usage is not a payment to put on an Eigenbeleg: it stands in the Verbrauchsauszug.
	const doc = buildDocument({
		payer: { ...payer, addresses: [entries[0].account] },
		chain: 'aleph',
		network: 'mainnet',
		period: { from: '2026-08-01', to: '2026-08-31' },
		entries
	});
	assert.equal(doc.positions.length, 0);
	assert.match(eigenbelegCsv(doc), /Verbrauch aus Guthaben: steht im Verbrauchsauszug/);
});

test('Aleph: a purchase of credits is credits in on the statement; its payment has an Eigenbeleg of its own (#23)', async () => {
	const entries = await alephPurchaseEntries();
	const args = {
		payer,
		account: entries[0].account,
		chain: 'aleph',
		network: 'mainnet',
		period: { from: '2026-08-01', to: '2026-08-31' }
	};
	const st = buildStatement({
		...args,
		entries,
		opening: { 'ALEPH-CREDIT': '2000000' },
		closing: { 'ALEPH-CREDIT': '3547800' },
		method: 'derived',
		number: 'VA-2026-08-01',
		issuedAt: '2026-09-01T08:00:00.000Z'
	});
	// The USD side of the purchase is not on the Verbrauchsauszug: no USD section, no unlisted movement.
	assert.deepEqual(
		st.sections.map((s) => s.asset),
		['ALEPH-CREDIT']
	);
	assert.equal(st.unlisted, 0);
	const [s] = st.sections;
	assert.equal(s.closing, '3547800');
	assert.deepEqual(
		s.rows.map((r) => [r.text, r.purchase, r.label]),
		[
			['Überweisung (Eingang)', true, 'Aleph Cloud (Kauf mit ALEPH auf ETH)'],
			['Verbrauch (aus Guthaben abgerechnet)', false, 'Aleph Cloud (storage)'],
			['Verbrauch (aus Guthaben abgerechnet)', false, 'Aleph Cloud (wolkenfabrik-web)'],
			['Überweisung (Eingang)', true, 'Aleph Cloud (Kauf mit ALEPH auf BASE)'],
			['Überweisung (Eingang)', false, '']
		]
	);
	// The month in sums (#24): per resource, in all, bought (both purchases), in; the transfer in has no rate.
	const m = s.monthly;
	assert.deepEqual(
		m.usage.map((l) => [l.label, l.amount, l.eur, l.rows]),
		[
			['Verbrauch Speicher (storage)', '200', '0.00032', 1],
			['Verbrauch wolkenfabrik-web', '2000', '0.0032', 1]
		]
	);
	assert.deepEqual(m.usageTotal, {
		label: 'Verbrauch gesamt (Aufwand)',
		amount: '2200',
		eur: '0.00352',
		rows: 2
	});
	assert.deepEqual(m.purchases, {
		label: 'Käufe von Guthaben (Vorauszahlung; Eigenbeleg je Kauf)',
		amount: '1500000',
		eur: '2.6',
		rows: 2
	});
	assert.deepEqual(
		[m.transfersIn?.amount, m.transfersIn?.eur, m.transfersIn?.rows],
		['50000', '', 1]
	);
	assert.equal(m.transfersOut, null);
	assert.equal(m.fees, null);
	assert.deepEqual(monthly([]), {
		usage: [],
		usageTotal: null,
		purchases: null,
		transfersIn: null,
		transfersOut: null,
		fees: null
	});
	const text = (await pages(await statementPdf(st))).join('\n').replace(/\s+/g, ' ');
	for (const expected of [
		'Monatsübersicht',
		'Verbrauch Speicher (storage) 200 0,0003',
		'Verbrauch wolkenfabrik-web 2.000 0,0032',
		'Verbrauch gesamt (Aufwand) 2.200 0,0035',
		'Käufe von Guthaben (Vorauszahlung; Eigenbeleg je Kauf) 1.500.000 2,6000',
		'Eingänge von anderen Konten 50.000 —'
	])
		assert.ok(text.includes(expected), expected);

	// The Eigenbeleg of the payment: a swap, included by the payer, called a purchase of a balance.
	const doc = buildDocument({
		...args,
		payer: { ...payer, addresses: [entries[0].account] },
		entries,
		includeKinds: ['swap'],
		layout: 'single',
		number: 'EB-2026-001',
		issuedAt: '2026-09-01T08:00:00.000Z'
	});
	assert.equal(doc.positions.length, 1);
	assert.equal(doc.positions[0].what, 'Kauf von Guthaben (Credits)');
	assert.equal(doc.note, ALEPH_NOTE);
	assert.deepEqual(doc.totals, { quantities: { USD: '1.25' }, eur: '1', eurExact: '1' });
	assert.deepEqual(
		doc.sources,
		['EZB-Referenzkurs USD/EUR'],
		'the day and its » vom« are stripped'
	);
	const [t] = doc.transactions;
	assert.deepEqual(
		t.movements.map((mv) => [mv.what, mv.onIt, mv.why]),
		[
			['Überweisung', false, 'Eingang, keine Zahlung'],
			['Kauf von Guthaben (Credits)', true, '']
		],
		'both sides of the transaction, the credits bought as the incoming movement'
	);
	const csv = eigenbelegCsv(doc);
	assert.match(
		csv,
		/;Kauf von Guthaben \(Credits\);Ausgang;Aleph Cloud \(Kauf von 500000 Credits mit ALEPH auf BASE\) \(aleph\);USD;native;-1,25;0,8;-1;EZB-Referenzkurs USD\/EUR vom 2026-08-10;/
	);
	assert.match(
		csv,
		/;Verbrauch \(aus Guthaben abgerechnet\);Ausgang;.*;nein;Verbrauch aus Guthaben: steht im Verbrauchsauszug/
	);
	const eb = (await pages(await eigenbelegPdf(doc))).join('\n').replace(/\s+/g, ' ');
	for (const expected of [
		'Eigenbeleg für eine Zahlung auf Aleph Cloud (Credits) (mainnet) am 10.08.2026',
		'Aleph Cloud (Credits): Kauf von Guthaben per Token-Zahlung an das Netzwerk, ohne Rechnung',
		'Aleph-Cloud-Guthaben (Credits) wird per Token-Zahlung an das Aleph-Netzwerk gekauft; Aleph stellt dafür keine Rechnung aus.',
		'Kauf von Guthaben (Credits) an Aleph Cloud (Kauf von 500000 Credits mit ALEPH auf BASE)',
		'Daten: Aleph-API (api2.aleph.im)',
		'EZB-Referenzkurs USD/EUR'
	])
		assert.ok(eb.includes(expected), expected);
	assert.doesNotMatch(eb, /Peer-to-Peer-Netzwerk/);
	assert.doesNotMatch(eb, /EZB-Referenzkurs USD\/EUR vom/);
});

test('the statement layout: head, fields, a table whose header repeats, page numbers, PDF/A', async () => {
	const bytes = await sheet();
	const text = await pages(bytes);
	assert.ok(text.length > 1, 'more than one page');
	const first = text[0].replace(/\s+/g, ' ');
	for (const expected of [
		'Eigenbeleg',
		'Nr. EB-2026-003',
		'Aussteller',
		'Wolkenfabrik Hosting GmbH',
		'Erstellt am 01.09.2026, 08:00 UTC',
		'Übernachtungspauschalen',
		'Москва',
		`EB-2026-003 · Seite 1 von ${text.length}`,
		'Erstellt mit Belege'
	])
		assert.ok(first.includes(expected), expected);
	const second = text[1].replace(/\s+/g, ' ');
	assert.ok(second.includes('EB-2026-003 · Aleph-Verbrauch 2026-08 (Fortsetzung)'));
	assert.ok(second.includes('Tag (UTC) Ressource Credits Item-Hash'), 'the header again');
	assert.ok(text.at(-1)?.includes('Ort, Datum, Unterschrift'));
	const s = pdfaStructure(bytes);
	assert.deepEqual(s.pdfaid, { part: '2', conformance: 'B' });
	assert.equal(s.xmp.creator, 'Wolkenfabrik Hosting GmbH', 'the issuer from the head');
	assert.equal(s.xmp.title, 'Eigenbeleg EB-2026-003 – Aleph-Verbrauch 2026-08');
	assert.deepEqual(await sheet(), bytes);
});
