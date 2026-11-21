// The company's own logo on the documents the app draws for these books
// (#906): the Eigenbeleg of one booking and the statements of Aleph, Akash,
// Filecoin Pay and travel. One per set of books, in the sealed `settings`
// collection, so it syncs like every other record and never sits in the
// clear in localStorage or a cache.
//
// What is kept is the picture as the documents carry it (@le-space/pdf's
// pdfImage: a PNG laid on white, a JPEG without its EXIF and profile), not
// the file that was chosen.

import { ImageError, pdfImage } from '@le-space/pdf/image';

import { getSetting, setSetting } from '../store/settings.js';

export const ISSUER_LOGO_KEY = 'issuerLogo';
/** The picture as kept, at most: what is synced to every device. */
export const ISSUER_LOGO_MAX_BYTES = 512 * 1024;

/**
 * @typedef {object} IssuerLogo
 * @property {'png' | 'jpeg'} type
 * @property {string} data the picture, base64
 * @property {number} width pixels
 * @property {number} height pixels
 * @property {boolean} on whether the documents carry it
 */

/** @param {Uint8Array} bytes */
function toBase64(bytes) {
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

/** @param {string} text @returns {Uint8Array | null} */
function fromBase64(text) {
	try {
		const s = atob(text);
		const out = new Uint8Array(s.length);
		for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

/**
 * A chosen file as the logo to keep, or an ImageError that says what is wrong with it.
 *
 * @param {Uint8Array} file
 * @returns {IssuerLogo}
 */
export function issuerLogoFrom(file) {
	const image = pdfImage(file);
	if (image.bytes.length > ISSUER_LOGO_MAX_BYTES)
		throw new ImageError(
			`the picture has ${Math.ceil(image.bytes.length / 1024)} kB once prepared; at most ${ISSUER_LOGO_MAX_BYTES / 1024} kB`
		);
	return {
		type: image.type,
		data: toBase64(image.bytes),
		width: image.width,
		height: image.height,
		on: true
	};
}

/**
 * What the setting holds, checked: null for nothing or anything that is not a logo.
 *
 * @param {unknown} value
 * @returns {IssuerLogo | null}
 */
export function cleanIssuerLogo(value) {
	const v = /** @type {any} */ (value);
	if (
		!v ||
		typeof v !== 'object' ||
		(v.type !== 'png' && v.type !== 'jpeg') ||
		typeof v.data !== 'string'
	)
		return null;
	const width = Number(v.width);
	const height = Number(v.height);
	if (!(width > 0 && height > 0)) return null;
	return { type: v.type, data: v.data, width, height, on: v.on !== false };
}

/**
 * The bytes the documents take (`issuerLogo` of @le-space/eigenbeleg), or null: none set, or switched off.
 *
 * @param {unknown} value the setting
 * @returns {Uint8Array | null}
 */
export function issuerLogoBytes(value) {
	const logo = cleanIssuerLogo(value);
	return logo?.on ? fromBase64(logo.data) : null;
}

/** @param {IssuerLogo} logo a blob: address of the picture, for showing it */
export function issuerLogoUrl(logo) {
	const bytes = fromBase64(logo.data) ?? new Uint8Array();
	return URL.createObjectURL(
		new Blob([/** @type {BlobPart} */ (bytes)], { type: `image/${logo.type}` })
	);
}

/**
 * The logo of these books for a document, read where it is kept. A store
 * without settings (a test's) draws none.
 *
 * @param {{ settings?: import('../store/repository.js').Collection }} store
 */
export async function issuerLogoOf(store) {
	return store?.settings
		? issuerLogoBytes(await getSetting(store.settings, ISSUER_LOGO_KEY))
		: null;
}

/**
 * @param {import('../store/repository.js').Collection} settings
 * @param {IssuerLogo | null} logo null removes it
 */
export function saveIssuerLogo(settings, logo) {
	return setSetting(settings, ISSUER_LOGO_KEY, logo ? cleanIssuerLogo(logo) : null);
}
