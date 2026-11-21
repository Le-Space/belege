// SPDX-License-Identifier: AGPL-3.0-or-later
// A picture from outside – a company's logo someone chose from their disk or
// sent with a request – made fit for a PDF/A: checked against limits before
// anything is unpacked, and reduced to what the document needs.
//
// - PNG: decoded, laid on white (PDF/A documents here carry no transparency)
//   and written again without
//   an alpha channel. Nothing else of the file survives: no
//   text chunk, no colour profile, no second frame.
// - JPEG: baseline or progressive, grey or three components. The compressed
//   picture is kept as it is; the segments that are not picture are cut out
//   (EXIF with its place and device, comments, an embedded profile).
// - Anything else (SVG among it: markup with links and scripts) is refused.
//
// The same bytes in, the same bytes out, in a browser and in Node.

import pakoModule from 'pako';
import upngModule from '@pdf-lib/upng';

// Node reads the package's CommonJS build (the library under `default`), a bundler its module.
const UPNG = /** @type {any} */ (
	'decode' in upngModule ? upngModule : /** @type {any} */ (upngModule).default
);
const PAKO = /** @type {any} */ (
	'Inflate' in pakoModule ? pakoModule : /** @type {any} */ (pakoModule).default
);

/** What is wrong with a picture, in words a person can act on. */
export class ImageError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = 'ImageError';
	}
}

/**
 * @typedef {object} ImageLimits
 * @property {number} bytes the file, at most
 * @property {number} side a side in pixels, at most
 * @property {number} minSide a side in pixels, at least
 * @property {number} widest width / height, at most
 * @property {number} tallest height / width, at most
 */

/** A logo: a small file, not a banner and not a column. */
export const IMAGE_LIMITS = /** @type {Readonly<ImageLimits>} */ (
	Object.freeze({ bytes: 512 * 1024, side: 2048, minSide: 16, widest: 6, tallest: 2 })
);

/**
 * @typedef {object} PdfImage
 * @property {'png' | 'jpeg'} type
 * @property {Uint8Array} bytes what goes into the PDF
 * @property {number} width pixels
 * @property {number} height pixels
 */

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** @param {Uint8Array} b @param {number} at */
const u16 = (b, at) => (b[at] << 8) | b[at + 1];
/** @param {Uint8Array} b @param {number} at */
const u32 = (b, at) => b[at] * 0x1000000 + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);

/** @param {number} width @param {number} height @param {ImageLimits} limits */
function checkSize(width, height, limits) {
	if (!width || !height) throw new ImageError('the picture has no size');
	if (width > limits.side || height > limits.side)
		throw new ImageError(
			`the picture is ${width} × ${height} pixels; at most ${limits.side} a side`
		);
	if (width < limits.minSide || height < limits.minSide)
		throw new ImageError(
			`the picture is ${width} × ${height} pixels; at least ${limits.minSide} a side`
		);
	if (width > height * limits.widest)
		throw new ImageError(`the picture is too wide: at most ${limits.widest} times its height`);
	if (height > width * limits.tallest)
		throw new ImageError(`the picture is too tall: at most ${limits.tallest} times its width`);
}

/**
 * The PNG file with nothing but its picture: header, palette, transparency
 * and data, each chunk checked to lie within the file. Text, profiles and an
 * animation's frames are left behind, and the decoder never sees a chunk
 * whose length runs past the end. The data is unpacked once here, only to
 * count: a file that would unpack to more than its header's size is refused
 * before the decoder gets it.
 *
 * @param {Uint8Array} bytes @param {number} width @param {number} height
 */
function plainPng(bytes, width, height) {
	const depth = bytes[24];
	const channels = [1, 0, 3, 1, 2, 0, 4][bytes[25]];
	if (!channels || ![1, 2, 4, 8, 16].includes(depth) || bytes[26] || bytes[27] || bytes[28] > 1)
		throw new Error('header');
	/** @type {Uint8Array[]} */
	const kept = [bytes.subarray(0, 8)];
	/** @type {Uint8Array[]} */
	const data = [];
	let ended = false;
	for (let at = 8; at + 12 <= bytes.length && !ended; ) {
		const length = u32(bytes, at);
		const end = at + 12 + length;
		if (end > bytes.length) throw new Error('chunk');
		const name = u32(bytes, at + 4);
		// IHDR, PLTE, tRNS, IDAT, IEND
		if ([0x49484452, 0x504c5445, 0x74524e53, 0x49444154, 0x49454e44].includes(name))
			kept.push(bytes.subarray(at, end));
		if (name === 0x49444154) data.push(bytes.subarray(at + 8, at + 8 + length));
		ended = name === 0x49454e44;
		at = end;
	}
	if (!ended || !data.length) throw new Error('end');
	// Rows of an interlaced picture come in seven passes, each row with a filter byte.
	const most = 2 * (Math.ceil((width * channels * depth) / 8) + 1) * height + 64;
	let unpacked = 0;
	const inflate = new PAKO.Inflate();
	inflate.onData = (/** @type {Uint8Array} */ chunk) => {
		unpacked += chunk.length;
		if (unpacked > most) throw new Error('more data than the picture has');
	};
	inflate.onEnd = () => {};
	data.forEach((d, i) => inflate.push(d, i === data.length - 1));
	if (inflate.err) throw new Error('data');
	return concat(kept);
}

/** @param {Uint8Array[]} parts */
function concat(parts) {
	const out = new Uint8Array(parts.reduce((n, k) => n + k.length, 0));
	let o = 0;
	for (const k of parts) {
		out.set(k, o);
		o += k.length;
	}
	return out;
}

/** @param {Uint8Array} bytes @param {ImageLimits} limits @returns {PdfImage} */
function png(bytes, limits) {
	// The size is read from the header first: nothing is unpacked for a picture that is too large.
	if (bytes.length < 33 || u32(bytes, 12) !== 0x49484452)
		throw new ImageError('the PNG file is damaged');
	const width = u32(bytes, 16);
	const height = u32(bytes, 20);
	checkSize(width, height, limits);
	let rgba;
	try {
		const plain = plainPng(bytes, width, height);
		const decoded = UPNG.decode(plain.buffer);
		if (decoded.width !== width || decoded.height !== height) throw new Error('size');
		rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
		if (rgba.length !== width * height * 4) throw new Error('length');
	} catch {
		throw new ImageError('the PNG file cannot be read');
	}
	// On white, and opaque from here on.
	for (let i = 0; i < rgba.length; i += 4) {
		const a = rgba[i + 3];
		if (a === 255) continue;
		rgba[i] = Math.round((rgba[i] * a + 255 * (255 - a)) / 255);
		rgba[i + 1] = Math.round((rgba[i + 1] * a + 255 * (255 - a)) / 255);
		rgba[i + 2] = Math.round((rgba[i + 2] * a + 255 * (255 - a)) / 255);
		rgba[i + 3] = 255;
	}
	return {
		type: 'png',
		bytes: new Uint8Array(UPNG.encode([rgba.buffer], width, height, 0)),
		width,
		height
	};
}

/** @param {Uint8Array} bytes @param {ImageLimits} limits @returns {PdfImage} */
function jpeg(bytes, limits) {
	const damaged = () => new ImageError('the JPEG file is damaged');
	/** @type {Uint8Array[]} */
	const kept = [bytes.subarray(0, 2)];
	let width = 0;
	let height = 0;
	let at = 2;
	for (;;) {
		if (at + 4 > bytes.length || bytes[at] !== 0xff) throw damaged();
		const marker = bytes[at + 1];
		// Fill bytes before a marker.
		if (marker === 0xff) {
			at++;
			continue;
		}
		const length = u16(bytes, at + 2);
		if (length < 2 || at + 2 + length > bytes.length) throw damaged();
		const segment = bytes.subarray(at, at + 2 + length);
		// The scan: from here on it is the picture, kept to the end as it is.
		if (marker === 0xda) {
			if (!width) throw damaged();
			kept.push(bytes.subarray(at));
			break;
		}
		const frame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
		if (frame) {
			// Baseline, extended and progressive, Huffman coded: what every PDF reader shows.
			if (marker > 0xc2 || length < 8)
				throw new ImageError('this kind of JPEG is not supported; save it as baseline JPEG or PNG');
			if (width) throw damaged();
			if (segment[4] !== 8)
				throw new ImageError('the JPEG has more than 8 bits a colour; save it with 8');
			height = u16(segment, 5);
			width = u16(segment, 7);
			checkSize(width, height, limits);
			if (segment[9] !== 1 && segment[9] !== 3)
				throw new ImageError('the JPEG is in CMYK; save it as RGB or as PNG');
		}
		// Kept: the frame, the tables, the restart interval, JFIF (APP0) and Adobe's note on
		// how the colours are coded (APP14). Cut: every other application segment – EXIF and
		// XMP (APP1), a colour profile (APP2), Photoshop's (APP13) – and comments.
		const cut = (marker >= 0xe1 && marker <= 0xef && marker !== 0xee) || marker === 0xfe;
		if (!cut) kept.push(segment);
		at += 2 + length;
	}
	const out = concat(kept);
	return { type: 'jpeg', bytes: out, width, height };
}

/**
 * A PNG or JPEG file as a picture a PDF/A can carry, or an ImageError that
 * says what is wrong with it.
 *
 * @param {Uint8Array} bytes the file
 * @param {Partial<ImageLimits>} [limits] IMAGE_LIMITS where not given
 * @returns {PdfImage}
 */
export function pdfImage(bytes, limits = {}) {
	const lim = { ...IMAGE_LIMITS, ...limits };
	if (!(bytes instanceof Uint8Array))
		throw new ImageError('the picture must be the bytes of a file');
	if (bytes.length > lim.bytes)
		throw new ImageError(
			`the file has ${Math.ceil(bytes.length / 1024)} kB; at most ${Math.floor(lim.bytes / 1024)} kB`
		);
	if (PNG.every((v, i) => bytes[i] === v)) return png(bytes, lim);
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes, lim);
	throw new ImageError('the picture must be a PNG or a JPEG file');
}

/**
 * Embeds a picture (pdfImage) in a document.
 *
 * @param {import('pdf-lib').PDFDocument} pdf
 * @param {PdfImage} image
 * @returns {Promise<import('pdf-lib').PDFImage>}
 */
export function embedPdfImage(pdf, image) {
	return image.type === 'png' ? pdf.embedPng(image.bytes) : pdf.embedJpg(image.bytes);
}
