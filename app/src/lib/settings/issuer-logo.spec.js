import { describe, expect, it } from 'vitest';
import { sampleJpeg, samplePng } from '@le-space/pdf/testing/sample-images';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';

import {
	cleanIssuerLogo,
	ISSUER_LOGO_KEY,
	issuerLogoBytes,
	issuerLogoFrom,
	issuerLogoOf,
	saveIssuerLogo
} from './issuer-logo.js';

/** A settings collection in memory, with the repository's list and put. */
function memorySettings() {
	/** @type {any[]} */
	const records = [];
	return {
		records,
		list: async (/** @type {any} */ o = {}) => records.filter(o.where ?? (() => true)),
		put: async (/** @type {any} */ r) => {
			const i = records.findIndex((x) => x.key === r.key);
			if (i >= 0) records[i] = r;
			else records.push(r);
			return r;
		}
	};
}

describe('the company logo (#906)', () => {
	it('keeps the picture as the documents carry it, not the file', () => {
		const png = issuerLogoFrom(samplePng());
		expect([png.type, png.width, png.height, png.on]).toEqual(['png', 240, 80, true]);
		const jpeg = issuerLogoFrom(sampleJpeg());
		expect(jpeg.type).toBe('jpeg');
		// The bytes kept are the drawing's: a JPEG without its EXIF is shorter than the file.
		expect(issuerLogoBytes(jpeg)?.length).toBeLessThanOrEqual(sampleJpeg().length);
	});

	it('refuses what cannot be a logo with an ImageError', () => {
		const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
		expect(() => issuerLogoFrom(svg)).toThrow(/PNG or a JPEG/);
		expect(() => issuerLogoFrom(new Uint8Array(600 * 1024))).toThrow(/at most 512 kB/);
	});

	it('reads only what is a logo, and gives none while it is switched off', () => {
		expect(cleanIssuerLogo(null)).toBeNull();
		expect(cleanIssuerLogo({ type: 'gif', data: 'x', width: 1, height: 1 })).toBeNull();
		expect(cleanIssuerLogo({ type: 'png', data: 'x', width: 0, height: 1 })).toBeNull();
		const logo = issuerLogoFrom(samplePng());
		expect(issuerLogoBytes(logo)).toBeInstanceOf(Uint8Array);
		expect(issuerLogoBytes({ ...logo, on: false })).toBeNull();
		expect(issuerLogoBytes(null)).toBeNull();
	});

	it('is kept in the settings under its key and read back for a document', async () => {
		const settings = memorySettings();
		const store = { settings: /** @type {any} */ (settings) };
		expect(await issuerLogoOf(store)).toBeNull();
		expect(await issuerLogoOf(/** @type {any} */ ({}))).toBeNull();
		await saveIssuerLogo(/** @type {any} */ (settings), issuerLogoFrom(samplePng()));
		expect(settings.records.map((r) => r.key)).toEqual([ISSUER_LOGO_KEY]);
		const bytes = await issuerLogoOf(store);
		expect(bytes).toBeInstanceOf(Uint8Array);

		// What the statements draw with it: one opaque picture, still PDF/A-2b.
		const { statementLayout } = await import('@le-space/eigenbeleg/statement-layout');
		const s = await statementLayout({
			title: 'Eigenbeleg EB-2026-001',
			created: new Date('2026-11-01T10:00:00Z'),
			continuation: 'EB-2026-001',
			issuerLogo: bytes
		});
		s.head('EB-2026-001', 'Wolkenfabrik Hosting GmbH', 'Verbrauch');
		const pdf = pdfaStructure(await s.save());
		expect(pdf.images).toEqual([
			{ width: 240, height: 80, colorSpace: 'DeviceRGB', softMask: false }
		]);

		await saveIssuerLogo(/** @type {any} */ (settings), null);
		expect(await issuerLogoOf(store)).toBeNull();
	});
});
