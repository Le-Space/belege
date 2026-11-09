// SPDX-License-Identifier: AGPL-3.0-or-later
// The structure PDF/A-2b asks for, checked in the file: XMP that matches the
// info dictionary, the sRGB output intent, the id, embedded fonts only, and
// the same bytes for the same document. veraPDF checks the rest in CI
// (.github/workflows/packages.yml, the samples of @le-space/eigenbeleg).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { asset, createPdfA, LOGOS, savePdfA } from '../src/index.js';
import { pdfaStructure } from './support/pdfa-structure.js';

const meta = {
	title: 'Eigenbeleg EB-2026-001',
	author: 'Wolkenfabrik Hosting GmbH',
	subject: 'Beleg für eine Zahlung',
	creator: 'Belege',
	created: new Date('2026-10-05T08:00:00Z')
};

async function sample() {
	const { pdf, fonts } = await createPdfA();
	const page = pdf.addPage([595.28, 841.89]);
	fonts.bold.draw(page, 'Eigenbeleg', { x: 48, y: 780, size: 20 });
	fonts.regular.draw(page, 'Wolkenfabrik Hosting GmbH · Москва · فندق المثال', {
		x: 48,
		y: 750,
		size: 10
	});
	fonts.mono.draw(page, `0x${'ab'.repeat(20)}`, { x: 48, y: 730, size: 8 });
	return savePdfA(pdf, meta);
}

test('PDF/A-2b in the file: XMP like the info, sRGB intent, an id from the content, embedded fonts', async () => {
	const bytes = await sample();
	const s = pdfaStructure(bytes);
	assert.equal(s.header, '%PDF-1.7');
	assert.deepEqual(s.pdfaid, { part: '2', conformance: 'B' });
	assert.equal(s.xmp.title, meta.title);
	assert.equal(s.xmp.creator, meta.author);
	assert.equal(s.xmp.description, meta.subject);
	assert.equal(s.xmp.creatorTool, 'Belege');
	assert.equal(s.xmp.producer, 'Belege, pdf-lib');
	assert.equal(s.xmp.createDate, '2026-10-05T08:00:00Z');
	assert.equal(s.info.Title, meta.title, 'the info dictionary says the same');
	assert.equal(s.info.Author, meta.author);
	assert.equal(s.info.Creator, 'Belege');
	assert.equal(s.info.Producer, 'Belege, pdf-lib');
	assert.ok(s.outputIntent, 'an sRGB output intent with its profile');
	const id = createHash('sha256')
		.update(`${meta.title}|${meta.created.toISOString()}|${meta.author}`)
		.digest('hex')
		.slice(0, 32);
	assert.equal(s.id, id);
	assert.ok(s.embeddedFonts >= 3, `${s.embeddedFonts} embedded fonts`);
	assert.deepEqual(s.standardFonts, []);
	assert.equal(s.language, 'de-DE');
});

test('the same document is the same file', async () => {
	assert.deepEqual(await sample(), await sample());
});

test('an empty author or subject is left out of the info and the XMP alike', async () => {
	const { pdf } = await createPdfA();
	pdf.addPage();
	const s = pdfaStructure(
		await savePdfA(pdf, { title: 'Kontoauszug', creator: 'eigenbeleg', created: meta.created })
	);
	assert.equal(s.xmp.creator, null);
	assert.equal(s.xmp.description, null);
	assert.equal(s.info.Author, undefined);
	assert.equal(s.info.Subject, undefined);
});

test("the chains' marks: 192 × 192 PNG on white, embedded as an opaque RGB image", async () => {
	assert.deepEqual(Object.keys(LOGOS), ['near', 'akash', 'filecoin', 'aleph']);
	for (const [chain, name] of Object.entries(LOGOS)) {
		const png = await asset(name);
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		// IHDR: width, height, bit depth 8, colour type 2 (RGB, no alpha channel).
		assert.deepEqual(
			[view.getUint32(16), view.getUint32(20), png[24], png[25]],
			[192, 192, 8, 2],
			chain
		);
		assert.ok(!new TextDecoder('latin1').decode(png).includes('tRNS'), `${chain}: no transparency`);
		const { pdf } = await createPdfA();
		const page = pdf.addPage();
		page.drawImage(await pdf.embedPng(png), { x: 48, y: 700, width: 22, height: 22 });
		const s = pdfaStructure(await savePdfA(pdf, meta));
		assert.deepEqual(s.images, [
			{ width: 192, height: 192, colorSpace: 'DeviceRGB', softMask: false }
		]);
	}
	assert.deepEqual(pdfaStructure(await sample()).images, [], 'no image unless one is drawn');
});
