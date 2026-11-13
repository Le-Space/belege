// SPDX-License-Identifier: AGPL-3.0-or-later
// Title cards: the opening, a card before each scene, and the closing card —
// one page, built for the kind of card, in the brand's palette, with the
// brand's mark drawing itself and the wordmark and the title following. A
// card is recorded like a scene (record-cards.js), so a film is nothing but
// recordings laid end to end.
//
// Everything that makes a card someone's is the brand's: the mark, the
// wordmark, the palette, the typeface, the texts of the opening and closing
// cards per language, the address and its QR. Nothing is loaded from the
// network: the font comes as a data URI, the QR as SVG text (qr.js makes one
// in Node). This module runs in a browser as well as in Node.

/**
 * @typedef {{ night: string, panel: string, snow: string, muted: string,
 *   accent: string, accent2: string, ink: string, line: string }} Palette
 *   night: the background; snow: text; muted: secondary text; accent: the
 *   rule, the eyebrow, the address; accent2: the wordmark's prefix; ink: the
 *   QR's modules
 *
 * @typedef {{ tagline: string, introSay: string | null, scene: string,
 *   facts: string[], outroSay: string | null, scan: string }} CardTexts
 *
 * @typedef {{
 *   name: string,
 *   mark: (cls?: string) => string,
 *   words: string,
 *   css?: string,
 *   stillCss?: string,
 *   palette: Palette,
 *   font?: { family: string, src: string } | null,
 *   texts: Record<string, CardTexts>,
 *   site: string,
 *   qr?: string | null,
 *   introTitle?: string
 * }} Brand
 *   name: the page title; mark: the signet as SVG markup, with the class
 *   `mark` (and `cls`); words: the wordmark, a `.words` element with
 *   `.prefix` and `.name` inside; css: the brand's own rules (how its mark
 *   draws itself); stillCss: the same mark already drawn, for the small logo
 *   of a scene card; texts: per language, `en` the fallback; site: the
 *   address the closing card shows; qr: an SVG of the app's address, dark on
 *   light (qr.js), or none
 */

/**
 * @typedef {{ card: 'intro' | 'scene' | 'outro', n?: number, eyebrow?: string, title?: string,
 *   sub?: string, say?: string | null, hold?: number }} CardSpec
 */

/** A card's clip name in out/: film, position, kind — what record-cards.js writes and compose.js looks for. */
export const cardName = (
	/** @type {string} */ film,
	/** @type {number} */ i,
	/** @type {{ card: string }} */ part
) => `${film}-${String(i).padStart(2, '0')}-${part.card}`;

const esc = (/** @type {unknown} */ s) =>
	String(s ?? '').replace(
		/[&<>"]/g,
		(c) =>
			/** @type {Record<string, string>} */ ({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;'
			})[c]
	);

/** @param {Brand} brand */
function baseCss(brand) {
	const p = brand.palette;
	const family = brand.font
		? `${brand.font.family}, system-ui, sans-serif`
		: 'system-ui, sans-serif';
	const face = brand.font
		? `@font-face { font-family: ${brand.font.family}; src: url(${brand.font.src}) format('woff2'); font-weight: 100 900; font-display: block; }\n`
		: '';
	return `${face}:root { --night: ${p.night}; --panel: ${p.panel}; --snow: ${p.snow}; --muted: ${p.muted}; --accent: ${p.accent}; --accent-2: ${p.accent2}; --ink: ${p.ink}; --line: ${p.line}; }
html, body { margin: 0; width: 100%; height: 100%; background: var(--night); color: var(--snow); overflow: hidden; }
body { font-family: ${family}; font-weight: 400; -webkit-font-smoothing: antialiased; }
.card { position: absolute; inset: 0; display: grid; }
.mark { display: block; }
.words { display: flex; flex-direction: column; line-height: 1; }
.prefix { color: var(--accent-2); letter-spacing: .32em; font-weight: 500; opacity: 0; }
.name { font-weight: 700; letter-spacing: -.03em; opacity: 0; transform: translateY(14px); }
.go .prefix { animation: fade 500ms ease-out 1250ms forwards; }
.go .name { animation: rise 600ms cubic-bezier(.2,.7,.2,1) 1450ms forwards; }
.fade { opacity: 0; } .rise { opacity: 0; transform: translateY(18px); }
.go .fade { animation: fade 600ms ease-out var(--at, 0ms) forwards; }
.go .rise { animation: rise 700ms cubic-bezier(.2,.7,.2,1) var(--at, 0ms) forwards; }
.rule { height: 6px; width: 0; background: var(--accent); border-radius: 3px; }
.go .rule { animation: grow 600ms cubic-bezier(.2,.7,.2,1) var(--at, 0ms) forwards; }
@keyframes fade { to { opacity: 1; } }
@keyframes rise { to { opacity: 1; transform: none; } }
@keyframes grow { to { width: 140px; } }

/* intro: everything centred */
.intro { place-items: center; }
.intro .stack { display: flex; flex-direction: column; align-items: center; gap: 36px; }
.intro .mark { width: 260px; height: 260px; }
.intro .words { align-items: center; gap: 18px; }
.intro .prefix { font-size: 34px; }
.intro .name { font-size: 136px; }
.intro .tagline { font-size: 34px; line-height: 44px; color: var(--muted); margin-top: 6px; }

/* scene: a small logo, a big title */
.scene { grid-template-rows: auto 1fr; padding: 72px 120px; box-sizing: border-box; }
.scene .logo { display: flex; align-items: center; gap: 22px; }
.scene .logo .mark { width: 64px; height: 64px; }
.scene .logo .words { gap: 6px; } .scene .prefix { font-size: 14px; } .scene .name { font-size: 34px; }
.scene .block { align-self: center; max-width: 1400px; display: flex; flex-direction: column; gap: 28px; }
.scene .eyebrow { color: var(--accent); font-size: 28px; letter-spacing: .22em; text-transform: uppercase; font-weight: 500; }
.scene h1 { margin: 0; font-size: 84px; line-height: 92px; font-weight: 700; letter-spacing: -.02em; }
.scene .sub { font-size: 36px; line-height: 48px; color: var(--muted); max-width: 1200px; }

/* outro: the address and its QR */
.outro { place-items: center; }
.outro .row { display: grid; grid-template-columns: auto auto; gap: 140px; align-items: center; }
.outro .left { display: flex; flex-direction: column; gap: 34px; }
.outro .logo { display: flex; align-items: center; gap: 28px; }
.outro .logo .mark { width: 120px; height: 120px; }
.outro .logo .words { gap: 10px; } .outro .prefix { font-size: 22px; } .outro .name { font-size: 72px; }
.outro .facts { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; font-size: 32px; line-height: 40px; color: var(--muted); }
.outro .facts li::before { content: '·'; color: var(--accent); margin-right: 16px; font-weight: 700; }
.outro .url { font-size: 44px; font-weight: 600; color: var(--accent); letter-spacing: -.01em; }
.outro .panel { background: #fff; border-radius: 24px; padding: 28px; width: 360px; height: 360px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.outro .panel svg { width: 100%; height: auto; }
.outro .scan { color: var(--ink); font-size: 20px; margin-top: 10px; }
`;
}

/**
 * The cards of one brand.
 * @param {Brand} brand
 */
export function createCards(brand) {
	const css = baseCss(brand) + (brand.css ?? '');
	const words = brand.words;

	/**
	 * A card as the film lists it, completed with the defaults of its kind.
	 * @param {CardSpec} part
	 * @param {{ lang: string }} film
	 */
	function resolveCard(part, film) {
		const t = brand.texts[film.lang] ?? brand.texts.en;
		const base = { lang: film.lang, ...part };
		if (part.card === 'intro')
			return {
				title: brand.introTitle ?? brand.name,
				sub: t.tagline,
				say: t.introSay,
				hold: 5000,
				...base
			};
		if (part.card === 'outro')
			return {
				facts: t.facts,
				say: t.outroSay,
				scan: t.scan,
				hold: 7000,
				...base
			};
		const eyebrow = part.eyebrow ?? (part.n ? `${t.scene} ${part.n}` : '');
		return { eyebrow, say: part.title ?? null, hold: 4000, ...base };
	}

	/**
	 * The page of one card.
	 * @param {any} c a card from resolveCard
	 * @param {number} [scale] the frame's height over 1080: the card is laid out
	 *   for 1920×1080 and drawn larger (a transform rasterises the text at the
	 *   larger size, so it stays sharp)
	 */
	function cardHtml(c, scale = 1) {
		const mark = brand.mark();
		let body;
		if (c.card === 'intro') {
			body = `<div class="card intro"><div class="stack">${mark}${words}<div class="tagline fade" style="--at: 2100ms">${esc(c.sub)}</div></div></div>`;
		} else if (c.card === 'outro') {
			const panel = brand.qr
				? `<div class="panel rise" style="--at: 2200ms">${brand.qr}<div class="scan">${esc(c.scan)}</div></div>`
				: '';
			body = `<div class="card outro"><div class="row">
  <div class="left">
    <div class="logo">${mark}${words}</div>
    <ul class="facts">${(c.facts ?? []).map((/** @type {string} */ f, /** @type {number} */ i) => `<li class="fade" style="--at: ${1700 + i * 220}ms">${esc(f)}</li>`).join('')}</ul>
    <div class="url rise" style="--at: 2500ms">${esc(brand.site)}</div>
  </div>
  ${panel}
</div></div>`;
		} else {
			body = `<div class="card scene">
  <div class="logo fade" style="--at: 150ms">${mark}${words}</div>
  <div class="block">
    ${c.eyebrow ? `<div class="eyebrow fade" style="--at: 450ms">${esc(c.eyebrow)}</div>` : ''}
    <div class="rule" style="--at: 650ms"></div>
    <h1 class="rise" style="--at: 900ms">${esc(c.title)}</h1>
    ${c.sub ? `<div class="sub rise" style="--at: 1400ms">${esc(c.sub)}</div>` : ''}
  </div>
</div>`;
		}
		// A scene card's logo should be there, not drawn: the mark and the
		// wordmark start finished.
		const still =
			c.card === 'scene'
				? `<style>${brand.stillCss ?? ''}.scene .prefix,.scene .name{opacity:1;transform:none;animation:none}</style>`
				: '';
		const frame =
			scale === 1
				? ''
				: `<style>.card{inset:auto;left:0;top:0;width:1920px;height:1080px;transform:scale(${scale});transform-origin:0 0}</style>`;
		return `<!doctype html><html lang="${esc(c.lang)}"><head><meta charset="utf-8"><title>${esc(brand.name)}</title><style>${css}</style>${still}${frame}</head><body>${body}</body></html>`;
	}

	return { resolveCard, cardHtml, cardName };
}
