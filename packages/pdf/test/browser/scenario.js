// SPDX-License-Identifier: AGPL-3.0-or-later
// A PDF/A page in every script the fonts have, with a chain's mark, in a
// browser: the fonts and the mark come by fetch there (assets-browser.js),
// from disk in Node; browser.test.js compares the two, byte for byte. Made-up text only.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { asset, createPdfA, LOGOS, pdfText, savePdfA, wrapText } from '../../src/index.js';
import { pdfaStructure } from '../support/pdfa-structure.js';

export default async function scenario() {
	const { pdf, fonts } = await createPdfA();
	const page = pdf.addPage([595.28, 841.89]);
	let y = 790;
	for (const line of [
		'Wolkenfabrik Hosting GmbH – Musterstraße 1, 12345 Beispielstadt',
		'Москва Казанская · Αθήνα · İstanbul · Żółć',
		'Hotel: فندق المثال, 950,00 AED',
		'東京駅'
	]) {
		fonts.regular.draw(page, line, { x: 48, y, size: 10 });
		y -= 16;
	}
	const lines = wrapText(`0x${'cd'.repeat(32)}`, fonts.mono, 8, 200);
	for (const l of lines) {
		fonts.mono.draw(page, l, { x: 48, y, size: 8 });
		y -= 11;
	}
	fonts.bold.draw(page, 'Eigenbeleg', { x: 48, y, size: 20 });
	// A chain's mark, fetched there too.
	page.drawImage(await pdf.embedPng(await asset(LOGOS.near)), { x: 170, y, width: 22, height: 22 });
	const bytes = await savePdfA(pdf, {
		title: 'Eigenbeleg EB-2026-001',
		author: 'Wolkenfabrik Hosting GmbH',
		creator: 'Belege',
		created: new Date('2026-10-05T08:00:00Z')
	});
	return {
		sha256: bytesToHex(sha256(bytes)),
		length: bytes.length,
		lines: lines.length,
		width: Math.round(fonts.regular.width('Москва فندق', 10) * 100) / 100,
		text: pdfText('a‮b\nc'),
		structure: pdfaStructure(bytes)
	};
}
