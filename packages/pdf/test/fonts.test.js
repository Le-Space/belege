// SPDX-License-Identifier: AGPL-3.0-or-later
// Text in any script the books hold, drawn and read back. Made-up lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

import { pdfFonts, pdfText, wrapText } from '../src/index.js';

// Made-up lines in the scripts the books hold.
const LINES = [
	'Hauptbahnhof Musterstadt – 89,90 € · Grüße',
	'Москва Казанская → Казань Пассажирская, 4 512,30 руб.',
	'Київ-Пасажирський – Львів, 650,00 грн',
	'Kraków Główny · Żółć · Příliš žluťoučký kůň',
	'İstanbul Esenler · Ayşe Yılmaz · ğüşöç',
	'Αθήνα · Θεσσαλονίκη',
	'فندق المثال',
	'Hotel: فندق المثال, 950,00 AED',
	'東京駅'
];

/** @param {Uint8Array} bytes */
const textOf = async (bytes) =>
	(await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true })).text;

test('draws Latin, Cyrillic, Greek, Polish, Czech, Turkish and Arabic; a letter no font has is a ?', async () => {
	const pdf = await PDFDocument.create();
	const { regular, bold, mono } = await pdfFonts(pdf);
	const page = pdf.addPage([595, 842]);
	let y = 800;
	for (const line of LINES) {
		regular.draw(page, line, { x: 40, y, size: 12 });
		y -= 24;
	}
	bold.draw(page, 'Reisekostenabrechnung · Пассажир', { x: 40, y, size: 14 });
	y -= 24;
	mono.draw(page, '0x00ab…ef · Счёт 40702810 · فندق', { x: 40, y, size: 10 });
	const bytes = await pdf.save();
	const text = await textOf(bytes);
	for (const expected of [
		'Москва Казанская',
		'Київ-Пасажирський',
		'Żółć',
		'žluťoučký',
		'İstanbul',
		'Yılmaz',
		'Αθήνα',
		'Пассажир',
		'Счёт',
		'0x00ab…ef'
	]) {
		assert.ok(text.includes(expected), expected);
	}
	assert.ok(text.includes('???'));
	// Only the letters used are embedded.
	assert.ok(bytes.length < 200_000, `${bytes.length} bytes`);
	// No standard font: everything is embedded (PDF/A).
	assert.doesNotMatch(
		new TextDecoder('latin1').decode(bytes),
		/\/BaseFont \/(Helvetica|Courier|Times)/
	);
});

test('measures a mixed line as the sum of its runs; mono is fixed width', async () => {
	const pdf = await PDFDocument.create();
	const { regular, mono } = await pdfFonts(pdf);
	const a = regular.width('Hotel ', 10);
	const b = regular.width('فندق', 10);
	assert.ok(Math.abs(regular.width('Hotel فندق', 10) - (a + b)) < 0.05);
	assert.equal(mono.width('iiii', 10), mono.width('WWWW', 10));
});

test('plain text: one line, no control or format characters', () => {
	assert.equal(pdfText('1 000 − 5\nzwei'), '1 000 - 5 zwei');
	// A right-to-left override would turn the text around; a NUL breaks a viewer.
	assert.equal(pdfText('Konto‮A\u0000B​'), 'KontoAB');
	assert.equal(pdfText(undefined), '');
});

test('wraps at spaces and breaks a word wider than the line, never cutting it', async () => {
	const pdf = await PDFDocument.create();
	const { mono, regular } = await pdfFonts(pdf);
	const hash = `0x${'ab'.repeat(32)}`;
	const lines = wrapText(`Hash ${hash}`, mono, 9, 120);
	assert.ok(lines.length > 2);
	assert.equal(lines.join('').replace('Hash', ''), hash);
	for (const l of lines) assert.ok(mono.width(l, 9) <= 120, l);
	assert.deepEqual(wrapText('Erste Zeile\nZweite Zeile', regular, 9, 400), [
		'Erste Zeile',
		'Zweite Zeile'
	]);
});
