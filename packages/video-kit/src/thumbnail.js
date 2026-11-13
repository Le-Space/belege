// SPDX-License-Identifier: AGPL-3.0-or-later
// A film's thumbnail: its scene card, still, as a 1920×1080 PNG — the same
// page the recording shows, so the thumbnail and the film look alike.
//
//   await thumbnails({ out: 'out', films: ['e2e-video/films/words-en.json'], cards });
//
// Writes <out>/<film id>-thumb.png per film (the first scene card in the
// list; the opening card if a film has none). Node only.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

/**
 * @param {{ out: string, films: string[], cards: ReturnType<typeof import('./card.js').createCards> }} o
 */
export async function thumbnails({ out, films, cards }) {
	out = resolve(out);
	mkdirSync(out, { recursive: true });
	const browser = await chromium.launch();
	const page = await browser.newPage({
		viewport: { width: 1920, height: 1080 }
	});
	for (const file of films) {
		const film = JSON.parse(readFileSync(file, 'utf8'));
		const id = basename(file).replace(/\.json$/, '');
		const part =
			film.parts.find((/** @type {any} */ p) => p.card === 'scene') ??
			film.parts.find((/** @type {any} */ p) => p.card);
		if (!part) continue;
		await page.setContent(cards.cardHtml(cards.resolveCard(part, film)));
		await page.evaluate(() => document.fonts.ready);
		// Straight to the end of the card's animation.
		await page.addStyleTag({
			content:
				'*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; }'
		});
		await page.evaluate(() => document.body.classList.add('go'));
		await page.waitForTimeout(100);
		const target = resolve(out, `${id}-thumb.png`);
		await page.screenshot({ path: target, scale: 'css' });
		console.log(`${id}: ${target}`);
	}
	await browser.close();
}
