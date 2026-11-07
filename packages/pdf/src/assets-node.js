// SPDX-License-Identifier: AGPL-3.0-or-later
// The PDFs' binary assets in Node: read from the installed font packages and
// from this package's assets/. A browser build takes assets-browser.js
// instead (package.json "imports", condition "browser").

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** @type {Record<string, () => string>} */
const PATHS = {
	'DejaVuSansCondensed.ttf': () => require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf'),
	'DejaVuSansCondensed-Bold.ttf': () =>
		require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf'),
	'DejaVuSansMono.ttf': () => require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf'),
	'NotoSansArabic-Regular.ttf': () =>
		require.resolve('@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf'),
	'sRGB-v2-micro.icc': () => fileURLToPath(new URL('../assets/sRGB-v2-micro.icc', import.meta.url))
};

/** @param {string} name @returns {Promise<Uint8Array>} */
export async function loadAsset(name) {
	const path = Object.hasOwn(PATHS, name) ? PATHS[name] : null;
	if (!path) throw new Error(`unknown asset ${name}`);
	return new Uint8Array(await readFile(path()));
}
