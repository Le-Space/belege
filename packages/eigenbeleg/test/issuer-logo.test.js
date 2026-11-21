// SPDX-License-Identifier: AGPL-3.0-or-later
// The issuer's own logo on its own documents (#906): on the Eigenbeleg of a
// period, the Kontoauszug and the Eigenbeleg of one booking, only when a
// file is handed in, as one opaque picture, and without moving a word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';
import { sampleJpeg, samplePng } from '@le-space/pdf/testing/sample-images';

import {
	bookingPdf,
	buildDocument,
	buildStatement,
	eigenbelegPdf,
	ImageError,
	IMAGE_LIMITS,
	ISSUER_LOGO_BOX,
	statementPdf
} from '../src/index.js';
import { statementLayout } from '../src/statement-layout.js';
import { nearEntries, payer, walletBooking } from './support/samples.js';

/** @param {Uint8Array} bytes */
const text = async (bytes) =>
	/** @type {string[]} */ ((await extractText(await getDocumentProxy(bytes.slice()))).text).join(
		'\n'
	);

const period = { from: '2026-10-01', to: '2026-10-31' };
const issuedAt = '2026-11-06T10:00:00.000Z';
const own = { width: 240, height: 80, colorSpace: 'DeviceRGB', softMask: false };
const mark = { width: 192, height: 192, colorSpace: 'DeviceRGB', softMask: false };

/** The three documents, each as a function of its options. */
async function documents() {
	const entries = await nearEntries();
	const args = { payer, chain: 'near', network: 'testnet', period, entries, issuedAt };
	const doc = buildDocument({ ...args, number: 'EB-2026-007' });
	const single = buildDocument({ ...args, number: 'EB-2026-008', layout: 'single' });
	const st = buildStatement({
		...args,
		account: 'wolkenfabrik.testnet',
		opening: { NEAR: '10' },
		closing: { NEAR: '12.998303634875' },
		method: 'archive',
		number: 'KA-2026-10-01'
	});
	return {
		single,
		/** @type {Record<string, (o?: any) => Promise<Uint8Array>>} */
		draw: {
			Eigenbeleg: (o) => eigenbelegPdf(doc, o),
			Kontoauszug: (o) => statementPdf(st, o),
			Buchung: (o) => bookingPdf(walletBooking, o),
			// The layout of the app's own statements (Aleph, Akash, Filecoin Pay, travel).
			Aufstellung: async (o) => {
				const s = await statementLayout({
					title: 'Eigenbeleg EB-2026-009',
					created: new Date(issuedAt),
					continuation: 'Eigenbeleg EB-2026-009 (Fortsetzung)',
					issuerLogo: o?.issuerLogo
				});
				s.head('EB-2026-009', 'Wolkenfabrik Hosting GmbH', 'Verbrauch Oktober 2026');
				s.field('Zeitraum', '01.10.2026 – 31.10.2026');
				s.table(
					[
						{ title: 'Tag', width: 80 },
						{ title: 'Betrag', width: 80, right: true }
					],
					[['01.10.2026', '−12,34 €']]
				);
				s.signature();
				return s.save();
			}
		}
	};
}

test("the issuer's logo is on each document when a file is handed in, and only then", async () => {
	const { draw } = await documents();
	for (const [name, pdf] of Object.entries(draw)) {
		const plain = await pdf();
		assert.deepEqual(pdfaStructure(plain).images, [], `${name}: no picture without one`);
		assert.deepEqual(await pdf({ issuerLogo: null }), plain, `${name}: null is none`);
		for (const file of [samplePng(), sampleJpeg()]) {
			const with1 = await pdf({ issuerLogo: file });
			const s = pdfaStructure(with1);
			assert.deepEqual(s.images, [own], `${name}: one opaque picture`);
			assert.deepEqual(s.pdfaid, { part: '2', conformance: 'B' });
			assert.deepEqual(
				await pdf({ issuerLogo: file }),
				with1,
				`${name}: the same bytes every time`
			);
			// Not a word more, fewer or elsewhere in the reading order.
			assert.equal(await text(with1), await text(plain), `${name}: the text is the same`);
		}
	}
});

test("beside the chain's mark: two pictures, each its own", async () => {
	const { draw, single } = await documents();
	for (const name of ['Eigenbeleg', 'Kontoauszug']) {
		const both = pdfaStructure(await draw[name]({ logo: true, issuerLogo: samplePng() }));
		assert.deepEqual(
			both.images.toSorted((a, b) => a.width - b.width),
			[mark, own],
			name
		);
	}
	// One Eigenbeleg per payment, each with the logo in its head: embedded once.
	const pages = await eigenbelegPdf(single, { issuerLogo: samplePng() });
	assert.deepEqual(pdfaStructure(pages).images, [own]);
});

test('a file that is no small PNG or JPEG is an ImageError, never a document', async () => {
	const { draw } = await documents();
	const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
	for (const [name, pdf] of Object.entries(draw)) {
		await assert.rejects(pdf({ issuerLogo: svg }), ImageError, name);
		await assert.rejects(
			pdf({ issuerLogo: new Uint8Array(IMAGE_LIMITS.bytes + 1) }),
			/at most 512 kB/,
			name
		);
	}
});

test('the room for it: a word mark fits, and a tall logo is no taller than the title block', () => {
	assert.deepEqual([...ISSUER_LOGO_BOX], [120, 40]);
	assert.ok(IMAGE_LIMITS.widest >= ISSUER_LOGO_BOX[0] / ISSUER_LOGO_BOX[1]);
});
