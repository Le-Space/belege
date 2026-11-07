// SPDX-License-Identifier: AGPL-3.0-or-later
// Belege's Eigenbeleg of one booking, in Eigenbeleg's layout and PDF/A-2b:
// the number range, what the PDF says, text in any script. All made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import { bookingPdf, nextSelfNumber } from '../src/index.js';
import { bankBooking, walletBooking } from './support/samples.js';

/** @param {Uint8Array} bytes */
const textOf = async (bytes) =>
	(await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text;

test('numbers each year on its own: EB-YYYY-NNN', () => {
	const receipts = [
		{ selfNumber: 'EB-2026-001' },
		{ selfNumber: 'EB-2026-009' },
		{ selfNumber: 'EB-2025-042' },
		{ selfNumber: 'RE-2026-500' },
		{}
	];
	assert.equal(nextSelfNumber(receipts, '2026'), 'EB-2026-010');
	assert.equal(nextSelfNumber(receipts, '2025'), 'EB-2025-043');
	assert.equal(nextSelfNumber([], '2027'), 'EB-2027-001');
	assert.equal(nextSelfNumber([{ selfNumber: 'EB-2026-999' }], '2026'), 'EB-2026-1000');
});

test('a bank booking: number, amount, counterparty, what and why, a line to sign', async () => {
	const bytes = await bookingPdf(bankBooking);
	const text = (await textOf(bytes)).replace(/\s+/g, ' ');
	for (const expected of [
		'Eigenbeleg',
		'Nr. EB-2026-001',
		'Beleg für eine Zahlung, zu der es keinen Beleg der Gegenseite gibt.',
		'Empfänger',
		'Stromwerk Test AG',
		'Konto A',
		'25.09.2026',
		'Barauslage Beispielzweck',
		'-12,34 €',
		'Parkgebühr am Automaten',
		'Der Automat gibt keine Quittung aus.',
		'berechtigt nicht zum Vorsteuerabzug',
		'Erstellt mit Belege',
		'Ort, Datum, Unterschrift',
		'EB-2026-001 · Seite 1'
	]) {
		assert.ok(text.includes(expected), expected);
	}
	assert.ok(!text.includes('Block-Explorer'), 'no chain, no explorer');
});

test('an own wallet’s booking: the whole hash, both addresses, every movement, the explorer link', async () => {
	const bytes = await bookingPdf(walletBooking);
	const text = await textOf(bytes);
	const flat = text.replace(/\s/g, '');
	const c = /** @type {NonNullable<typeof walletBooking.chain>} */ (walletBooking.chain);
	for (const whole of [c.hash, c.from.address, c.to.address, c.explorerUrl])
		assert.ok(flat.includes(whole), whole);
	for (const expected of [
		'Gas(Netzwerkgebühr)-0,00018ETH-0,42€ja',
		'Tausch–erhalten(nichtgebucht)30.000XYZ—nein',
		'-0,143ETH',
		'2.345,67EURjeETH·CoinGecko,26.09.2026',
		'ZahlungaufEthereum·26.09.202609:12:34UTC',
		'eigeneWallet'
	])
		assert.ok(flat.includes(expected), expected);
	// Cyrillic and Arabic drawn, not as "?".
	assert.ok(text.includes('Конто Б'));
	assert.ok(!flat.includes('???'));
});

test('PDF/A-2b: XMP as the info, the issuer as author, Belege as creator, the same file twice', async () => {
	const bytes = await bookingPdf(walletBooking);
	const s = pdfaStructure(bytes);
	assert.deepEqual(s.pdfaid, { part: '2', conformance: 'B' });
	assert.equal(s.xmp.title, 'Eigenbeleg EB-2026-002');
	assert.equal(s.info.Title, 'Eigenbeleg EB-2026-002');
	assert.equal(s.xmp.creator, 'Wolkenfabrik Hosting GmbH');
	assert.equal(s.xmp.creatorTool, 'Belege');
	assert.equal(s.xmp.createDate, '2026-09-27T10:00:00Z');
	assert.ok(s.outputIntent);
	assert.match(String(s.id), /^[0-9a-f]{32}$/);
	assert.deepEqual(s.standardFonts, []);
	assert.deepEqual(await bookingPdf(walletBooking), bytes);
	// No issuer: no author.
	assert.equal(pdfaStructure(await bookingPdf(bankBooking)).xmp.creator, null);
	// Another program names itself.
	assert.equal(
		pdfaStructure(await bookingPdf(bankBooking, { creator: 'eigenbeleg' })).xmp.creatorTool,
		'eigenbeleg'
	);
});
