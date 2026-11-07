// SPDX-License-Identifier: AGPL-3.0-or-later
// The documents' binary assets (DejaVu fonts, sRGB profile) in Node: read from
// the installed packages. The browser build takes assets-browser.js instead
// (package.json "imports", condition "browser").

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {Record<string, () => string>} */
const PATHS = {
	'DejaVuSansCondensed.ttf': () => require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf'),
	'DejaVuSansCondensed-Bold.ttf': () => require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf'),
	'DejaVuSansMono.ttf': () => require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf'),
	'sRGB-v2-micro.icc': () => new URL('../assets/sRGB-v2-micro.icc', import.meta.url).pathname
};

/** @param {string} name @returns {Promise<Uint8Array>} */
export async function loadAsset(name) {
	const path = PATHS[name];
	if (!path) throw new Error(`unknown asset ${name}`);
	return new Uint8Array(await readFile(path()));
}
