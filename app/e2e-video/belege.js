// Belege's side of the demo films: its brand on the title cards, its
// narrator's voice folder and pronunciation, and the scene preconfigured with
// both. The kit itself is @le-space/video-kit (packages/video-kit).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCards } from '@le-space/video-kit/card';
import { qrSvg } from '@le-space/video-kit/qr';
import { startScene as kitStartScene } from '@le-space/video-kit/scene';
import { createVoice } from '@le-space/video-kit/voice';

export const NIGHT = '#0b0e15';
export const APP_URL = 'https://belege.le-space.de/';

/**
 * The narrator. Spoken lines are kept in e2e-video/voice/ (not in git). Eleven
 * v4 reads IPA between slashes: "Belege" gets its German sound from an
 * English voice; captions keep the written word.
 */
export const voice = createVoice({
	dir: fileURLToPath(new URL('./voice/', import.meta.url)),
	pronounce: { Belege: '/beˈleːɡə/', belege: '/beˈleːɡə/' }
});

/**
 * A scene of Belege, narrated, on Belege's night.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Record<string, string> | string[]} lines
 * @param {{ lang?: string, captions?: boolean }} [options]
 */
export const startScene = (page, context, lines, options = {}) =>
	kitStartScene(page, context, lines, { voice, night: NIGHT, ...options });

const font = `data:font/woff2;base64,${readFileSync(new URL('./brand/sora-latin-wght-normal.woff2', import.meta.url)).toString('base64')}`;

// The signet (coin and receipt), drawn as in the marketing site's
// BelegeLogo.svelte; the coin's ring draws itself, the receipt settles in.
const SIGNET = `<svg class="mark " viewBox="0 0 100 100" aria-hidden="true">
  <circle class="coin" cx="36" cy="38" r="27" fill="none" stroke-width="17" pathLength="100" transform="rotate(-90 36 38)"/>
  <path class="receipt" fill-rule="evenodd" d="M43 47 h50 a9 9 0 0 1 9 9 v37 a9 9 0 0 1 -9 9 h-50 a9 9 0 0 1 -9 -9 v-37 a9 9 0 0 1 9 -9 z M58 60 h20 a6 6 0 0 1 6 6 v17 a6 6 0 0 1 -6 6 h-20 a6 6 0 0 1 -6 -6 v-17 a6 6 0 0 1 6 -6 z"/>
</svg>`;

/** @type {string | null} */
let qr = null;

/**
 * The style guide's colours and type (night, panel, snow, muted, lime,
 * violet; Sora), the signet, and the texts of the opening and closing cards.
 * @type {import('@le-space/video-kit/card').Brand}
 */
export const BRAND = {
	name: 'Le Space Belege',
	introTitle: 'belege',
	mark: () => SIGNET,
	words: `<span class="words" aria-hidden="true"><span class="prefix">LE SPACE</span><span class="name">belege</span></span>`,
	// Round caps: where the drawn dash meets its own start, the caps overlap and no seam shows.
	css: `.coin { stroke: var(--accent); stroke-linecap: round; stroke-dasharray: 100; stroke-dashoffset: 100; }
.receipt { fill: var(--snow); opacity: 0; transform: translateY(6px); }
.go .coin { animation: draw 900ms cubic-bezier(.2,.7,.2,1) 200ms forwards; }
.go .receipt { animation: settle 600ms cubic-bezier(.2,.7,.2,1) 800ms forwards; }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes settle { to { opacity: 1; transform: none; } }
`,
	stillCss:
		'.scene .coin{stroke-dashoffset:0;animation:none}.scene .receipt{opacity:1;transform:none;animation:none}',
	palette: {
		night: NIGHT,
		panel: '#161b26',
		snow: '#f4f6fb',
		muted: '#8a94a6',
		accent: '#c6f24e',
		accent2: '#7c5cff',
		ink: '#0f1b2d',
		line: '#2a3140'
	},
	font: { family: 'Sora', src: font },
	site: 'www.belege.le-space.de',
	// Made on first use: qrencode runs only where a closing card is drawn.
	get qr() {
		return (qr ??= qrSvg(APP_URL, { ink: '#0f1b2d' }));
	},
	texts: {
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
	}
};

export const cards = createCards(BRAND);
