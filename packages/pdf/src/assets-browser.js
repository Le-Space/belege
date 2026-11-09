// SPDX-License-Identifier: AGPL-3.0-or-later
// The PDFs' binary assets in a browser: the bundler (Vite, `?url`) copies the
// fonts, the sRGB profile and the chains' marks next to the page; they are
// fetched only when a PDF is drawn (a mark only when one is asked for), so
// the page itself stays light (and a service worker can keep them for
// offline use).

import condensed from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed.ttf?url';
import condensedBold from 'dejavu-fonts-ttf/ttf/DejaVuSansCondensed-Bold.ttf?url';
import mono from 'dejavu-fonts-ttf/ttf/DejaVuSansMono.ttf?url';
import arabic from '@expo-google-fonts/noto-sans-arabic/400Regular/NotoSansArabic_400Regular.ttf?url';
import icc from '../assets/sRGB-v2-micro.icc?url';
import nearPng from '../assets/logos/near.png?url';
import akashPng from '../assets/logos/akash.png?url';
import filecoinPng from '../assets/logos/filecoin.png?url';
import alephPng from '../assets/logos/aleph.png?url';

/** @type {Record<string, string>} */
const URLS = {
	'DejaVuSansCondensed.ttf': condensed,
	'DejaVuSansCondensed-Bold.ttf': condensedBold,
	'DejaVuSansMono.ttf': mono,
	'NotoSansArabic-Regular.ttf': arabic,
	'sRGB-v2-micro.icc': icc,
	'logos/near.png': nearPng,
	'logos/akash.png': akashPng,
	'logos/filecoin.png': filecoinPng,
	'logos/aleph.png': alephPng
};

/** @param {string} name @returns {Promise<Uint8Array>} */
export async function loadAsset(name) {
	const url = Object.hasOwn(URLS, name) ? URLS[name] : null;
	if (!url) throw new Error(`unknown asset ${name}`);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`asset ${name}: HTTP ${res.status}`);
	return new Uint8Array(await res.arrayBuffer());
}
