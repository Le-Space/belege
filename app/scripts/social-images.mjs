// The link preview images (issue #343): what X/Twitter, LinkedIn and
// Telegram show beside a link to the app, one per language. Made from
// static/favicon.svg and the catalogue's `social` texts, so they never drift
// from either. Run after either changes:
//   node scripts/social-images.mjs
// Needs Playwright's Chromium (installed for the E2E tests). Writes
// static/social/belege-de.png and belege-en.png, 1200×630.
//
// The rows on the card are made up, as in the sample books: no real vendor,
// amount or account.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import de from '../src/lib/i18n/de.js';
import en from '../src/lib/i18n/en.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const mark = readFileSync(join(root, 'static/favicon.svg'), 'utf8').replace(
	/width="32" height="32"/,
	'width="132" height="132"'
);

/** Made-up payments and their receipts, the same in both languages. */
const ROWS = [
	['Beispiel Kabel', '−39,99 €'],
	['Beispiel Cloud', '−12,00 €'],
	['Beispiel Papier', '−48,90 €']
];

/** @param {string} s */
const esc = (s) =>
	String(s).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c
	);

/** @param {{ social: { tagline: string, points: string[], badge: string } }} catalogue */
function card({ social }) {
	return `<!doctype html><html><head><meta charset="utf-8"><style>
	* { box-sizing: border-box; margin: 0; }
	body { width: 1200px; height: 630px; background: #0B0E15; color: #E8EDF5;
		font-family: -apple-system, 'Segoe UI', 'Inter', system-ui, sans-serif; overflow: hidden; }
	.page { display: flex; height: 100%; padding: 72px 60px 64px 72px; gap: 40px; }
	.left { width: 560px; flex: none; display: flex; flex-direction: column; }
	.brand { display: flex; align-items: center; gap: 28px; }
	.name { font-size: 64px; font-weight: 750; letter-spacing: -1.5px; line-height: 1; }
	.name small { display: block; font-size: 26px; font-weight: 600; color: #58C7F3; letter-spacing: 0; margin-bottom: 8px; }
	.tagline { margin-top: 44px; font-size: 40px; font-weight: 650; line-height: 1.2; letter-spacing: -0.5px; }
	ul { list-style: none; padding: 0; margin-top: auto; display: grid; gap: 14px; }
	li { font-size: 24px; color: #C9D3E3; display: flex; align-items: center; gap: 14px; }
	li::before { content: ''; width: 12px; height: 12px; border-radius: 50%; background: #58C7F3; flex: none; }
	.right { flex: 1; display: flex; align-items: center; }
	.panel { width: 100%; background: #141A26; border: 1px solid #263046; border-radius: 22px; padding: 26px; display: grid; gap: 16px; }
	.row { display: flex; align-items: center; gap: 14px; background: #0F141E; border-radius: 14px; padding: 18px 20px; }
	.who { flex: 1; font-size: 20px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.amount { font-size: 20px; color: #C9D3E3; font-variant-numeric: tabular-nums; }
	.badge { font-size: 17px; font-weight: 700; color: #0B0E15; background: #58C7F3; border-radius: 999px; padding: 6px 14px; }
	.link { height: 6px; border-radius: 3px; background: linear-gradient(90deg, #FF6B5B, #58C7F3); opacity: .8; }
	</style></head><body><div class="page">
	<div class="left">
		<div class="brand">${mark}<div class="name"><small>Le Space</small>Belege</div></div>
		<p class="tagline">${esc(social.tagline)}</p>
		<ul>${social.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
	</div>
	<div class="right"><div class="panel">
		${ROWS.map(
			([who, amount]) =>
				`<div class="row"><span class="who">${esc(who)}</span><span class="amount">${amount}</span><span class="badge">✓ ${esc(social.badge)}</span></div>`
		).join('<div class="link"></div>')}
	</div></div>
	</div></body></html>`;
}

const out = join(root, 'static/social');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
	for (const [lang, catalogue] of /** @type {const} */ ([
		['de', de],
		['en', en]
	])) {
		await page.setContent(card(/** @type {any} */ (catalogue)));
		await page.screenshot({ path: join(out, `belege-${lang}.png`), type: 'png' });
		console.log(`static/social/belege-${lang}.png`);
	}
} finally {
	await browser.close();
}
