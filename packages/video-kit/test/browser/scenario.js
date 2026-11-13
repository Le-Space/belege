// SPDX-License-Identifier: AGPL-3.0-or-later
// The cards and the subtitles in a browser: a made-up brand's three kinds of
// card and a scene's cues as SubRip. browser.test.js runs it in Node and in
// Chromium and compares.
import { createCards, cuesToSrt, ms2srt, srt2ms } from '../../src/index.js';
import { BRAND } from '../support/brand.js';

export default async function scenario() {
	const cards = createCards(BRAND);
	const film = { lang: 'de' };
	const pages = [
		{ card: 'intro' },
		{
			card: 'scene',
			n: 2,
			title: 'Eine Szene <mit> "Zeichen"',
			sub: 'Darunter eine Zeile'
		},
		{ card: 'outro' }
	].map((part) => cards.cardHtml(cards.resolveCard(/** @type {any} */ (part), film), 2));
	const srt = cuesToSrt([
		{ t: 0, text: 'One', durationMs: 900 },
		{ t: 5000, text: 'Two', durationMs: 4000 }
	]);
	return {
		lengths: pages.map((p) => p.length),
		escaped: pages[1].includes('Eine Szene &lt;mit&gt; &quot;Zeichen&quot;'),
		eyebrow: pages[1].includes('>Kapitel 2<'),
		srt,
		times: [ms2srt(3723004), srt2ms('01:02:03,004')]
	};
}
