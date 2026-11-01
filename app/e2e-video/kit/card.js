// Title cards: the opening, a card before each scene, and the closing card —
// the one page, built for the kind of card, in the brand's night palette with
// the signet drawn by CSS (the coin's ring draws itself, the receipt settles
// in, the wordmark and the title follow). A card is recorded like a scene
// (cards.spec.js), so the film is nothing but recordings laid end to end.
//
// Colours and type are the style guide's (night, panel, snow, muted, lime,
// violet; Sora; Display 64/68, H1 40/44). Nothing is loaded from the network:
// the font is a data URI, the QR is made here by `qrencode`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const font = `data:font/woff2;base64,${readFileSync(new URL('./brand/sora-latin-wght-normal.woff2', import.meta.url)).toString('base64')}`;

const APP_URL = 'https://belege.le-space.de/';
const SITE = 'www.belege.le-space.de';

/** Default texts of the opening and closing cards, per language. */
const TEXTS = {
	en: {
		tagline: 'Payments and receipts, sealed on your devices.',
		introSay: 'Le Space Belege. Payments and receipts, sealed on your devices.',
		scene: 'Scene',
		facts: ['no subscription, €0', 'open source, AGPL-3.0', 'no cloud, no server'],
		outroSay:
			'Le Space Belege. Open source, no cloud, no server. Try it at belege dot le-space dot de.',
		scan: 'Scan to open the app'
	},
	de: {
		tagline: 'Zahlungen und Belege, versiegelt auf deinen Geräten.',
		introSay: 'Le Space Belege. Zahlungen und Belege, versiegelt auf deinen Geräten.',
		scene: 'Szene',
		facts: ['kein Abo, 0 €', 'Open Source, AGPL-3.0', 'keine Cloud, kein Server'],
		outroSay:
			'Le Space Belege. Open Source, keine Cloud, kein Server. Zu finden unter belege Punkt le-space Punkt de.',
		scan: 'Scannen und die App öffnen'
	}
};

/**
 * A card as the film lists it, completed with the defaults of its kind.
 * @typedef {{ card: 'intro' | 'scene' | 'outro', n?: number, eyebrow?: string, title?: string,
 *   sub?: string, say?: string | null, hold?: number }} CardSpec
 * @param {CardSpec} part
 * @param {{ lang: 'en' | 'de' }} film
 */
export function resolveCard(part, film) {
	const t = TEXTS[film.lang] ?? TEXTS.en;
	const base = { lang: film.lang, ...part };
	if (part.card === 'intro')
		return { title: 'belege', sub: t.tagline, say: t.introSay, hold: 5000, ...base };
	if (part.card === 'outro')
		return { facts: t.facts, say: t.outroSay, scan: t.scan, hold: 7000, ...base };
	const eyebrow = part.eyebrow ?? (part.n ? `${t.scene} ${part.n}` : '');
	return { eyebrow, say: part.title ?? null, hold: 4000, ...base };
}

const SIGNET = (cls = '') => `<svg class="mark ${cls}" viewBox="0 0 100 100" aria-hidden="true">
  <circle class="coin" cx="36" cy="38" r="27" fill="none" stroke-width="17" pathLength="100" transform="rotate(-90 36 38)"/>
  <path class="receipt" fill-rule="evenodd" d="M43 47 h50 a9 9 0 0 1 9 9 v37 a9 9 0 0 1 -9 9 h-50 a9 9 0 0 1 -9 -9 v-37 a9 9 0 0 1 9 -9 z M58 60 h20 a6 6 0 0 1 6 6 v17 a6 6 0 0 1 -6 6 h-20 a6 6 0 0 1 -6 -6 v-17 a6 6 0 0 1 6 -6 z"/>
</svg>`;

const WORDS = `<span class="words" aria-hidden="true"><span class="prefix">LE SPACE</span><span class="name">belege</span></span>`;

/** The app's address as a QR, modules in ink on a white panel (a QR must stay dark on light to scan). */
function qrSvg() {
	const svg = execFileSync('qrencode', [
		'-t',
		'SVG',
		'-o',
		'-',
		'-m',
		'0',
		'-l',
		'M',
		APP_URL
	]).toString();
	return svg
		.replace(/<\?xml[^>]*>\s*/, '')
		.replace(/<!--[^]*?-->\s*/, '')
		.replace(
			/width="[^"]*" height="[^"]*"/,
			'width="100%" height="100%" shape-rendering="crispEdges"'
		)
		.replace(/#000000/g, '#0f1b2d');
}

/** A card's clip name in out/: film, position, kind — what cards.spec.js writes and compose.mjs looks for. */
export const cardName = (film, i, part) => `${film}-${String(i).padStart(2, '0')}-${part.card}`;

const esc = (s) =>
	String(s ?? '').replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
	);

const CSS = `
@font-face { font-family: Sora; src: url(${font}) format('woff2'); font-weight: 100 900; font-display: block; }
:root { --night: #0b0e15; --panel: #161b26; --snow: #f4f6fb; --muted: #8a94a6; --lime: #c6f24e; --violet: #7c5cff; --ink: #0f1b2d; --line: #2a3140; }
html, body { margin: 0; width: 100%; height: 100%; background: var(--night); color: var(--snow); overflow: hidden; }
body { font-family: Sora, system-ui, sans-serif; font-weight: 400; -webkit-font-smoothing: antialiased; }
.card { position: absolute; inset: 0; display: grid; }
.mark { display: block; }
/* Round caps: where the drawn dash meets its own start, the caps overlap and no seam shows. */
.coin { stroke: var(--lime); stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100; }
.receipt { fill: var(--snow); opacity: 0; transform: translateY(6px); }
.go .coin { animation: draw 900ms cubic-bezier(.2,.7,.2,1) 200ms forwards; }
.go .receipt { animation: settle 600ms cubic-bezier(.2,.7,.2,1) 800ms forwards; }
.words { display: flex; flex-direction: column; line-height: 1; }
.prefix { color: var(--violet); letter-spacing: .32em; font-weight: 500; opacity: 0; }
.name { font-weight: 700; letter-spacing: -.03em; opacity: 0; transform: translateY(14px); }
.go .prefix { animation: fade 500ms ease-out 1250ms forwards; }
.go .name { animation: rise 600ms cubic-bezier(.2,.7,.2,1) 1450ms forwards; }
.fade { opacity: 0; } .rise { opacity: 0; transform: translateY(18px); }
.go .fade { animation: fade 600ms ease-out var(--at, 0ms) forwards; }
.go .rise { animation: rise 700ms cubic-bezier(.2,.7,.2,1) var(--at, 0ms) forwards; }
.rule { height: 6px; width: 0; background: var(--lime); border-radius: 3px; }
.go .rule { animation: grow 600ms cubic-bezier(.2,.7,.2,1) var(--at, 0ms) forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes settle { to { opacity: 1; transform: none; } }
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
.scene .eyebrow { color: var(--lime); font-size: 28px; letter-spacing: .22em; text-transform: uppercase; font-weight: 500; }
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
.outro .facts li::before { content: '·'; color: var(--lime); margin-right: 16px; font-weight: 700; }
.outro .url { font-size: 44px; font-weight: 600; color: var(--lime); letter-spacing: -.01em; }
.outro .panel { background: #fff; border-radius: 24px; padding: 28px; width: 360px; height: 360px; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; gap: 16px; }
.outro .panel svg { width: 100%; height: auto; }
.outro .scan { color: var(--ink); font-size: 20px; margin-top: 10px; }
`;

/**
 * The page of one card.
 * @param {ReturnType<typeof resolveCard>} c
 * @param {number} [scale] the frame's height over 1080: the card is laid out
 *   for 1920×1080 and drawn larger (a transform rasterises the text at the
 *   larger size, so it stays sharp)
 */
export function cardHtml(c, scale = 1) {
	let body;
	if (c.card === 'intro') {
		body = `<div class="card intro"><div class="stack">${SIGNET()}${WORDS}<div class="tagline fade" style="--at: 2100ms">${esc(c.sub)}</div></div></div>`;
	} else if (c.card === 'outro') {
		body = `<div class="card outro"><div class="row">
  <div class="left">
    <div class="logo">${SIGNET()}${WORDS}</div>
    <ul class="facts">${(c.facts ?? []).map((f, i) => `<li class="fade" style="--at: ${1700 + i * 220}ms">${esc(f)}</li>`).join('')}</ul>
    <div class="url rise" style="--at: 2500ms">${SITE}</div>
  </div>
  <div class="panel rise" style="--at: 2200ms">${qrSvg()}<div class="scan">${esc(c.scan)}</div></div>
</div></div>`;
	} else {
		body = `<div class="card scene">
  <div class="logo fade" style="--at: 150ms">${SIGNET()}${WORDS}</div>
  <div class="block">
    ${c.eyebrow ? `<div class="eyebrow fade" style="--at: 450ms">${esc(c.eyebrow)}</div>` : ''}
    <div class="rule" style="--at: 650ms"></div>
    <h1 class="rise" style="--at: 900ms">${esc(c.title)}</h1>
    ${c.sub ? `<div class="sub rise" style="--at: 1400ms">${esc(c.sub)}</div>` : ''}
  </div>
</div>`;
	}
	// A scene card's logo should be there, not drawn: its coin and receipt start finished.
	const still =
		c.card === 'scene'
			? '<style>.scene .coin{stroke-dashoffset:0;animation:none}.scene .receipt{opacity:1;transform:none;animation:none}.scene .prefix,.scene .name{opacity:1;transform:none;animation:none}</style>'
			: '';
	const frame =
		scale === 1
			? ''
			: `<style>.card{inset:auto;left:0;top:0;width:1920px;height:1080px;transform:scale(${scale});transform-origin:0 0}</style>`;
	return `<!doctype html><html lang="${esc(c.lang)}"><head><meta charset="utf-8"><title>Le Space Belege</title><style>${CSS}</style>${still}${frame}</head><body>${body}</body></html>`;
}
