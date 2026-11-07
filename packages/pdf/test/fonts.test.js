import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

import { pdfFonts, pdfText } from './fonts.js';

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
	(await extractText(await getDocumentProxy(bytes), { mergePages: true })).text;

describe('PDF text in any script', () => {
	it('draws Latin, Cyrillic, Greek, Polish, Czech, Turkish and Arabic; a letter no font has is a ?', async () => {
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
		mono.draw(page, '0x00ab…ef · Счёт 40702810', { x: 40, y, size: 10 });
		const bytes = await pdf.save();
		if (process.env.PDF_FONTS_OUT)
			(await import('node:fs')).writeFileSync(process.env.PDF_FONTS_OUT, bytes);
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
			'Счёт'
		]) {
			expect(text, expected).toContain(expected);
		}
		expect(text).toContain('???');
		// Only the letters used are embedded.
		expect(bytes.length).toBeLessThan(200_000);
	});

	it('measures a mixed line as the sum of its runs; plain text helpers', async () => {
		const pdf = await PDFDocument.create();
		const { regular } = await pdfFonts(pdf);
		const a = regular.width('Hotel ', 10);
		const b = regular.width('فندق', 10);
		expect(regular.width('Hotel فندق', 10)).toBeCloseTo(a + b, 1);
		expect(pdfText('1 000 − 5\nzwei')).toBe('1 000 - 5 zwei');
	});
});
