// SPDX-License-Identifier: AGPL-3.0-or-later
// The title cards of every film in a folder, one Playwright test each: the
// page from card.js, its animation started, the narrator (if the card says
// anything), and a cues.json so compose.js treats the card like a scene.
//
//   // e2e-video/cards.spec.js
//   import { test } from '@playwright/test';
//   import { recordCards } from '@le-space/video-kit/record-cards';
//   recordCards(test, { films: new URL('./films/', import.meta.url), cards, scene: { voice, night } });
//
// Node only.
import { readdirSync, readFileSync } from 'node:fs';
import { startScene } from './scene.js';

/**
 * @param {import('@playwright/test').TestType<any, any>} test
 * @param {{
 *   films: URL,
 *   cards: ReturnType<typeof import('./card.js').createCards>,
 *   scene?: Omit<NonNullable<Parameters<typeof startScene>[3]>, 'lang' | 'captions'>
 * }} o films: the folder of the film lists; scene: what startScene takes besides
 *   the language (the narrator, the night)
 */
export function recordCards(test, { films: filmsDir, cards, scene: sceneOptions = {} }) {
	const dir = filmsDir.href.endsWith('/') ? filmsDir : new URL(`${filmsDir.href}/`);
	const films = readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.map((f) => ({
			id: f.replace(/\.json$/, ''),
			...JSON.parse(readFileSync(new URL(f, dir), 'utf8'))
		}));

	for (const film of films) {
		film.parts.forEach((/** @type {any} */ part, /** @type {number} */ i) => {
			if (!part.card) return;
			test(`${film.id}: card ${i} (${part.card})`, async ({ page, context }, testInfo) => {
				const card = cards.resolveCard(part, film);
				const scene = await startScene(page, context, card.say ? [card.say] : [], {
					...sceneOptions,
					lang: film.lang,
					captions: false
				});
				await page.setContent(cards.cardHtml(card, scene.scale));
				await page.evaluate(() => document.fonts.ready);
				await page.evaluate(() => document.body.classList.add('go'));
				scene.markStart();
				// The logo draws itself first; the voice comes in over the finished mark.
				await scene.beat(card.card === 'intro' ? 1600 : 1000);
				if (card.say) await scene.say(card.say, { after: 1200 });
				else await scene.beat(card.hold);
				await scene.finish(testInfo, {
					name: cards.cardName(film.id, i, part)
				});
			});
		});
	}
}
