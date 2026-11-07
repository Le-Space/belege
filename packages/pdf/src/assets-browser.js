// SPDX-License-Identifier: AGPL-3.0-or-later
// The documents' binary assets in the browser: the bundler (Vite, `?url`)
// copies the fonts and the sRGB profile next to the page; they are fetched
// only when a document is drawn, so the page itself stays light.

import condensed from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf?url';
import condensedBold from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf?url';
import mono from 'dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url';
import icc from '../assets/sRGB-v2-micro.icc?url';

/** @type {Record<string, string>} */
const URLS = { 'DejaVuSansCondensed.ttf': condensed, 'DejaVuSansCondensed-Bold.ttf': condensedBold, 'DejaVuSansMono.ttf': mono, 'sRGB-v2-micro.icc': icc };

/** @param {string} name @returns {Promise<Uint8Array>} */
export async function loadAsset(name) {
	const url = URLS[name];
	if (!url) throw new Error(`unknown asset ${name}`);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`asset ${name}: HTTP ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}
