// The files embedded in a PDF are read by name first and only up to a size:
// a small stream must not inflate into gigabytes in the tab. Made-up files.
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { inflateAtMost, pdfAttachments } from './pdf.js';

const XML = new TextEncoder().encode('<?xml version="1.0"?><Invoice>Beispiel</Invoice>');

async function pdfWith(/** @type {[string, Uint8Array][]} */ files) {
	const doc = await PDFDocument.create();
	doc.addPage();
	for (const [name, bytes] of files)
		await doc.attach(bytes, name, { mimeType: 'application/octet-stream' });
	return doc.save();
}

describe('pdfAttachments', () => {
	it('decodes only the names asked for', async () => {
		const pdf = await pdfWith([
			['factur-x.xml', XML],
			['other.bin', new Uint8Array(1024)]
		]);
		const all = await pdfAttachments(pdf);
		expect(all.map((a) => a.name).sort()).toEqual(['factur-x.xml', 'other.bin']);
		const some = await pdfAttachments(pdf, { accept: (n) => n.endsWith('.xml') });
		expect(some.map((a) => [a.name, new TextDecoder().decode(a.bytes)])).toEqual([
			['factur-x.xml', new TextDecoder().decode(XML)]
		]);
	});

	it('leaves out a file that inflates beyond the limit', async () => {
		const pdf = await pdfWith([
			['factur-x.xml', XML],
			['big.bin', new Uint8Array(4 * 1024 * 1024)]
		]);
		const read = await pdfAttachments(pdf, { maxBytes: 1024 * 1024 });
		expect(read.map((a) => a.name)).toEqual(['factur-x.xml']);
	});
});

describe('inflateAtMost', () => {
	it('stops at the limit: a few kilobytes that would be 64 MB give null', () => {
		const bomb = zlibSync(new Uint8Array(64 * 1024 * 1024), { level: 9 });
		expect(bomb.length).toBeLessThan(200 * 1024);
		expect(inflateAtMost(bomb, 5 * 1024 * 1024)).toBe(null);
	});

	it('gives the bytes when they fit, and null for broken data', () => {
		const small = new TextEncoder().encode('Rechnung 2026-1');
		expect(new TextDecoder().decode(inflateAtMost(zlibSync(small), 1024) ?? undefined)).toBe(
			'Rechnung 2026-1'
		);
		expect(inflateAtMost(new Uint8Array([1, 2, 3, 4]), 1024)).toBe(null);
	});
});
