// SPDX-License-Identifier: AGPL-3.0-or-later
// Aleph credits as a Verbrauchsauszug, and the statement layout Belege draws
// its statement Eigenbelege with. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import {
	USAGE_NOTE,
	buildStatement,
	eigenbelegCsv,
	buildDocument,
	statementPdf
} from '../src/index.js';
import { alephEntries, payer, sheet } from './support/samples.js';

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
