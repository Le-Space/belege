// Link previews (issue #343): the static tags X/Twitter, LinkedIn and
// Telegram read, in app.html (German) and static/en/index.html (English),
// carry the catalogue's `social` texts; the images are there at 1200×630;
// robots.txt lets the preview crawlers in and search engines not.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import de from './i18n/de.js';
import en from './i18n/en.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (/** @type {string} */ path) => readFileSync(`${root}${path}`);
const BASE = 'https://belege.le-space.de';

/** Every `<meta>` and `<link rel>` of a page, by property/name/rel. @param {string} html */
function tags(html) {
	/** @type {Record<string, string>} */
	const out = {};
	const unescape = (/** @type {string} */ s) =>
		s
			.replace(/&quot;/g, '"')
			.replace(/&lt;/g, '<')
			.replace(/&amp;/g, '&');
	for (const [, attrs] of html.matchAll(/<meta\s([^>]*?)\/?>/g)) {
		const key = /(?:property|name)="([^"]+)"/.exec(attrs)?.[1];
		const content = /content="([^"]*)"/.exec(attrs)?.[1];
		if (key && content !== undefined) out[key] = unescape(content);
	}
	for (const [, attrs] of html.matchAll(/<link\s([^>]*?)\/?>/g)) {
		const rel = /rel="([^"]+)"/.exec(attrs)?.[1];
		const lang = /hreflang="([^"]+)"/.exec(attrs)?.[1];
		const href = /href="([^"]+)"/.exec(attrs)?.[1];
		if (rel && href) out[lang ? `${rel}:${lang}` : rel] = href;
	}
	return out;
}

/** Width and height of a PNG, from its IHDR. @param {Buffer} png */
const size = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe('link previews (#343)', () => {
	for (const [lang, page, catalogue, url, locale] of /** @type {const} */ ([
		['de', 'src/app.html', de, `${BASE}/`, 'de_DE'],
		['en', 'static/en/index.html', en, `${BASE}/en/`, 'en_GB']
	])) {
		it(`${lang}: every tag the services read, with the catalogue's texts`, () => {
			const t = tags(String(read(page)));
			const { social } = /** @type {any} */ (catalogue);
			const image = `${BASE}/social/belege-${lang}.png`;
			expect(t).toMatchObject({
				description: social.description,
				canonical: url,
				'alternate:de': `${BASE}/`,
				'alternate:en': `${BASE}/en/`,
				'og:type': 'website',
				'og:site_name': 'Le Space Belege',
				'og:title': social.title,
				'og:description': social.description,
				'og:url': url,
				'og:locale': locale,
				'og:image': image,
				'og:image:width': '1200',
				'og:image:height': '630',
				'og:image:alt': social.imageAlt,
				'twitter:card': 'summary_large_image',
				'twitter:title': social.title,
				'twitter:description': social.description,
				'twitter:image': image,
				'twitter:image:alt': social.imageAlt,
				robots: 'noindex, nofollow'
			});
			expect(size(read(`static/social/belege-${lang}.png`))).toEqual([1200, 630]);
		});
	}

	it('the English entry opens the app in English, unless a language was chosen', () => {
		const html = String(read('static/en/index.html'));
		expect(html).toContain(
			"if (!localStorage.getItem('belege.locale')) localStorage.setItem('belege.locale', 'en');"
		);
		expect(html).toContain("location.replace('../')");
	});

	it('robots.txt: the preview crawlers in, everyone else out', () => {
		const robots = String(read('static/robots.txt'));
		for (const bot of ['Twitterbot', 'LinkedInBot', 'TelegramBot', 'facebookexternalhit']) {
			expect(robots).toMatch(new RegExp(`User-agent: ${bot}\\n(User-agent: .*\\n)*Allow: /`));
		}
		expect(robots).toMatch(/User-agent: \*\nDisallow: \/\n?$/);
	});
});
