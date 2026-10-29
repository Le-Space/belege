// The title cards of every film in films/, recorded one by one: the page from
// kit/card.js, its animation started, the narrator (if the card says
// anything), and a cues.json so compose.mjs treats the card like a scene.
// A film is then `node e2e-video/compose.mjs <out> --film films/<id>.json`.
import { test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { startScene } from './kit/scene.js';
import { cardHtml, cardName, resolveCard } from './kit/card.js';

const filmsDir = new URL('./films/', import.meta.url);
const films = readdirSync(filmsDir)
	.filter((f) => f.endsWith('.json'))
	.map((f) => ({
		id: f.replace(/\.json$/, ''),
		...JSON.parse(readFileSync(new URL(f, filmsDir), 'utf8'))
	}));

for (const film of films) {
	film.parts.forEach((part, i) => {
		if (!part.card) return;
		test(`${film.id}: card ${i} (${part.card})`, async ({ page, context }, testInfo) => {
			const card = resolveCard(part, film);
			const scene = await startScene(page, context, card.say ? [card.say] : [], {
				lang: film.lang,
				captions: false
			});
			await page.setContent(cardHtml(card));
			await page.evaluate(() => document.fonts.ready);
			await page.evaluate(() => document.body.classList.add('go'));
			scene.markStart();
			// The logo draws itself first; the voice comes in over the finished mark.
			await scene.beat(card.card === 'intro' ? 1600 : 1000);
			if (card.say) await scene.say(card.say, { after: 1200 });
			else await scene.beat(card.hold);
			await scene.finish(testInfo, { name: cardName(film.id, i, part) });
		});
	});
}
