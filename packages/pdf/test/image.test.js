// SPDX-License-Identifier: AGPL-3.0-or-later
// A picture from outside, made fit for a PDF/A: what is taken, what is cut
// out of it and what is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	createPdfA,
	embedPdfImage,
	ImageError,
	IMAGE_LIMITS,
	pdfImage,
	savePdfA
} from '../src/index.js';
import { pdfaStructure } from './support/pdfa-structure.js';
import { sampleJpeg, samplePng } from './support/sample-images.js';

const latin1 = (/** @type {Uint8Array} */ b) => new TextDecoder('latin1').decode(b);
/** @param {Uint8Array} file @param {RegExp} message @param {object} [limits] */
const refused = (file, message, limits) =>
	assert.throws(
		() => pdfImage(file, limits),
		(e) => e instanceof ImageError && message.test(e.message)
	);

/** A PNG file's chunk names, in order. @param {Uint8Array} b */
function chunks(b) {
	const out = [];
	for (let at = 8; at < b.length; ) {
		const length = new DataView(b.buffer, b.byteOffset + at).getUint32(0);
		out.push(latin1(b.subarray(at + 4, at + 8)));
		at += 12 + length;
	}
	return out;
}

/** `file` with a chunk put in after the header. @param {Uint8Array} file @param {string} name @param {string} text */
function withChunk(file, name, text) {
	const body = new TextEncoder().encode(text);
	const chunk = new Uint8Array(12 + body.length);
	new DataView(chunk.buffer).setUint32(0, body.length);
	chunk.set(new TextEncoder().encode(name), 4);
	chunk.set(body, 8);
	// The checksum is left zero: a reader that looked at the chunk would refuse it.
	const out = new Uint8Array(file.length + chunk.length);
	out.set(file.subarray(0, 33));
	out.set(chunk, 33);
	out.set(file.subarray(33), 33 + chunk.length);
	return out;
}

/** `file` with a segment put in after the first. @param {Uint8Array} file @param {number} marker @param {string} text */
function withSegment(file, marker, text) {
	const body = new TextEncoder().encode(text);
	const first = 4 + ((file[4] << 8) | file[5]);
	const out = new Uint8Array(file.length + 4 + body.length);
	out.set(file.subarray(0, first));
	out.set([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff], first);
	out.set(body, first + 4);
	out.set(file.subarray(first), first + 4 + body.length);
	return out;
}

test('a PNG with transparency becomes an opaque RGB picture on white, and nothing else of the file', () => {
	const file = withChunk(samplePng(), 'tEXt', 'Author\0Erika Beispiel');
	assert.match(latin1(file), /Erika Beispiel/);
	const image = pdfImage(file);
	assert.deepEqual([image.type, image.width, image.height], ['png', 240, 80]);
	// Header, perhaps a palette, data, end: no text, no profile, no transparency chunk.
	assert.deepEqual(
		chunks(image.bytes).filter((c) => c !== 'PLTE'),
		['IHDR', 'IDAT', 'IEND']
	);
	assert.doesNotMatch(latin1(image.bytes), /Erika Beispiel/);
	// Colour type 2 (red, green, blue) or 3 (a palette): no alpha channel.
	assert.ok([2, 3].includes(image.bytes[25]));
	assert.deepEqual(pdfImage(file).bytes, image.bytes, 'the same bytes every time');
	assert.deepEqual(pdfImage(samplePng()).bytes, image.bytes, 'whatever else the file carried');
});

test('a JPEG keeps its picture and loses EXIF, comments and other application segments', () => {
	const plain = sampleJpeg();
	assert.match(latin1(plain), /Exif/, 'the sample has an EXIF segment');
	const file = withSegment(
		withSegment(plain, 0xfe, 'made by Erika Beispiel'),
		0xed,
		'Photoshop 3.0 Musterstadt'
	);
	const image = pdfImage(file);
	assert.deepEqual([image.type, image.width, image.height], ['jpeg', 240, 80]);
	assert.doesNotMatch(latin1(image.bytes), /Exif|Erika|Photoshop/);
	assert.match(latin1(image.bytes), /JFIF/);
	assert.ok(image.bytes.length < plain.length);
	assert.deepEqual(pdfImage(plain).bytes, image.bytes, 'the picture itself is untouched');
	// From the scan to the end, byte for byte.
	const scan = (/** @type {Uint8Array} */ b) => latin1(b).slice(latin1(b).indexOf('\xff\xda'));
	assert.equal(scan(image.bytes), scan(plain));
});

test('both go into a PDF/A-2b as one opaque picture', async () => {
	for (const file of [samplePng(), sampleJpeg()]) {
		const { pdf } = await createPdfA();
		const page = pdf.addPage([300, 200]);
		page.drawImage(await embedPdfImage(pdf, pdfImage(file)), {
			x: 10,
			y: 10,
			width: 120,
			height: 40
		});
		const out = await savePdfA(pdf, {
			title: 'Logo',
			created: new Date('2026-10-01T10:00:00Z'),
			creator: 'test'
		});
		const s = pdfaStructure(out);
		assert.deepEqual(s.images, [
			{ width: 240, height: 80, colorSpace: 'DeviceRGB', softMask: false }
		]);
		assert.deepEqual(s.pdfaid, { part: '2', conformance: 'B' });
	}
});

test('what is not a small PNG or JPEG is refused, with words for the person', () => {
	refused(
		new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'),
		/PNG or a JPEG/
	);
	refused(new TextEncoder().encode('GIF89a'), /PNG or a JPEG/);
	refused(new Uint8Array(0), /PNG or a JPEG/);
	// @ts-expect-error not bytes
	refused('data:image/png;base64,AAAA', /bytes of a file/);
	refused(new Uint8Array(IMAGE_LIMITS.bytes + 1), /at most 512 kB/);
	refused(samplePng(), /at most 100 a side/, { side: 100 });
	refused(samplePng(), /at least 100 a side/, { minSide: 100 });
	refused(samplePng(), /too wide/, { widest: 2 });
	refused(sampleJpeg(), /too wide/, { widest: 2 });
	refused(samplePng().subarray(0, 200), /cannot be read/);
	refused(sampleJpeg().subarray(0, 40), /damaged/);
});

test('a size is believed from the header only after it passed the limits: nothing is unpacked for a huge picture', () => {
	const huge = samplePng();
	new DataView(huge.buffer).setUint32(16, 60000);
	new DataView(huge.buffer).setUint32(20, 60000);
	refused(huge, /60000 × 60000 pixels/);
	const tall = samplePng();
	new DataView(tall.buffer).setUint32(16, 20);
	refused(tall, /too tall/);
});

test('a JPEG in CMYK, with 12 bits or coded another way is refused', () => {
	const sof = (/** @type {Uint8Array} */ b) => latin1(b).indexOf('\xff\xc0');
	const cmyk = sampleJpeg();
	cmyk[sof(cmyk) + 9] = 4;
	refused(cmyk, /CMYK/);
	const deep = sampleJpeg();
	deep[sof(deep) + 4] = 12;
	refused(deep, /8 bits/);
	const lossless = sampleJpeg();
	lossless[sof(lossless) + 1] = 0xc3;
	refused(lossless, /not supported/);
});
