// A film's thumbnail: its scene card, still, as a 1280×720 PNG — the same
// page the recording shows, so the thumbnail and the film look alike.
//
//   node e2e-video/thumbnail.mjs <out dir> films/words-en.json [films/words-de.json …]
//
// Writes <out dir>/<film id>-thumb.png per film (the first scene card in the
// list; the opening card if a film has none).
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { cardHtml, resolveCard } from './kit/card.js';

const [outDir, ...films] = process.argv.slice(2);
if (!outDir || !films.length) {
	console.error('usage: node e2e-video/thumbnail.mjs <out dir> films/<id>.json …');
	process.exit(1);
}
const out = resolve(outDir);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
for (const file of films) {
	const film = JSON.parse(readFileSync(file, 'utf8'));
	const id = basename(file).replace(/\.json$/, '');
	const part = film.parts.find((p) => p.card === 'scene') ?? film.parts.find((p) => p.card);
	if (!part) continue;
	await page.setContent(cardHtml(resolveCard(part, film)));
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
