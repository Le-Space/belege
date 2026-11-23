// SPDX-License-Identifier: AGPL-3.0-or-later
// A stage: two or three browsers in one frame, with one narrator. Node only.
//
//   const stage = await startStage(browser, testInfo, LINES, {
//     voice, lang, night,
//     devices: {
//       laptop: { label: 'Laptop', x: 40, y: 90, width: 1100, height: 720 },
//       phone: { label: 'Phone', x: 1180, y: 90, width: 340, height: 720, zoom: 1 }
//     }
//   });
//   const { page } = stage.devices.laptop;   // a browser of its own, recording
//   await stage.say(LINES.intro);             // caption on the stage, voice
//   await stage.click(page, page.getByTestId('passkey-create'));
//   await stage.finish({ name: 'devices.en' });
//
// Each device is a browser context of its own, with its own video at its own
// size, its pointer and its zoom. The stage is one more page, as large as the
// frame: the brand's night, a frame and a name for each device, the caption
// bar and notes (`note`, e.g. "Internet: off"). compose.js lays every
// device's video onto the stage's video at its place and the voice under all
// of it (`composeResults` finds the stage by its cues.json).
//
// The clocks: every page turns night at a known moment of the cue clock
// (its marker, as in scene.js); compose.js finds that frame in each video.
//
// The layout is given for a 1920×1080 frame; a taller frame (the page's
// viewport, DEMO_RES) scales it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installCursor, click, type, moveTo } from './cursor.js';

/**
 * @typedef {object} DeviceSpot
 * @property {string} label the name over its frame
 * @property {number} x @property {number} y @property {number} width @property {number} height
 *   its place in a 1920×1080 frame
 * @property {number} [zoom] the page's root font size over 16 (scene.js); a
 *   phone's narrow layout wants 1, a laptop's 1.5 at 1080p (the default,
 *   DEMO_ZOOM). Scaled with the frame.
 * @property {import('@playwright/test').BrowserContextOptions} [context] more
 *   options for its context (locale, permissions, userAgent, isMobile …)
 */

/**
 * Escape text for the stage's HTML.
 * @param {string} s
 */
const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c
	);

/**
 * The stage's page: night, one framed hole per device (the device's video goes
 * there), its name above it, a place for notes and one for the chapter.
 * @param {{ width: number, height: number, night: string, scale: number,
 *   spots: (DeviceSpot & { name: string })[], font?: { family: string, src: string } | null }} o
 *   font: the brand's (a data URI, as on the cards), for the chapter
 */
export function stageHtml({ width, height, night, scale, spots, font = null }) {
	const s = scale;
	const face = font
		? `@font-face { font-family: ${font.family}; src: url(${font.src}) format('woff2'); font-weight: 100 900; font-display: block; }\n`
		: '';
	const family = `${font ? `${font.family}, ` : ''}system-ui, -apple-system, "Segoe UI", sans-serif`;
	const frames = spots
		.map(
			(
				d
			) => `<div class="device" id="device-${esc(d.name)}" style="left:${d.x * s}px;top:${d.y * s}px;width:${d.width * s}px;height:${d.height * s}px">
  <div class="label">${esc(d.label)}</div>
</div>`
		)
		.join('\n');
	return `<!doctype html><html><head><meta charset="utf-8"><title>stage</title><style>
${face}html, body { margin: 0; width: ${width}px; height: ${height}px; background: ${night}; overflow: hidden; }
body { font: 600 ${20 * s}px/1.3 ${family}; color: #fff; -webkit-font-smoothing: antialiased; }
.device { position: absolute; box-sizing: content-box; outline: ${2 * s}px solid rgba(255,255,255,0.16);
  border-radius: ${6 * s}px; transition: outline-color 300ms, opacity 300ms; }
.device.on { outline: ${3 * s}px solid var(--accent, #c6f432); }
.label { position: absolute; left: 0; bottom: 100%; margin-bottom: ${10 * s}px; white-space: nowrap;
  letter-spacing: 0.02em; color: rgba(255,255,255,0.86); }
.device.on .label { color: var(--accent, #c6f432); }
#notes { position: absolute; top: ${18 * s}px; right: ${28 * s}px; display: flex; gap: ${12 * s}px; }
.note { padding: ${6 * s}px ${14 * s}px; border-radius: ${999 * s}px; background: rgba(255,255,255,0.1);
  color: #fff; font-size: ${18 * s}px; }
.note.warn { background: #b42318; }
.note.ok { background: #1f6f43; }
#caption { position: absolute; left: 0; right: 0; bottom: 0; display: none; text-align: center;
  padding: ${16 * s}px ${28 * s}px; background: rgba(17, 24, 39, 0.86);
  font: 600 ${22 * s}px/1.35 ${family}; letter-spacing: 0.01em; }
#caption.on { display: block; }
#overlay { position: absolute; inset: auto ${60 * s}px ${130 * s}px ${60 * s}px; display: none;
  padding: ${18 * s}px ${24 * s}px; border-radius: ${10 * s}px; background: rgba(10,14,22,0.94);
  border-left: ${4 * s}px solid var(--accent, #c6f432);
  font: 500 ${18 * s}px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; z-index: 2; }
#overlay.on { display: block; animation: rise 420ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes rise { from { opacity: 0; transform: translateY(${16 * s}px); } }
/* The chapter: a number in the accent, a rule that draws itself, the title sliding in. */
#chapter { position: absolute; left: ${40 * s}px; top: ${22 * s}px; display: flex; align-items: center;
  gap: ${16 * s}px; font-family: ${family}; }
#chapter .n { color: var(--accent, #c6f432); font-size: ${22 * s}px; font-weight: 600; letter-spacing: .18em;
  opacity: 0; transition: opacity 300ms; }
#chapter .rule { width: 0; height: ${3 * s}px; background: var(--accent, #c6f432); border-radius: ${2 * s}px;
  transition: width 500ms cubic-bezier(.2,.8,.2,1) 120ms; }
#chapter .title { font-size: ${34 * s}px; font-weight: 700; letter-spacing: -.01em; opacity: 0;
  transform: translateX(${-18 * s}px); transition: opacity 450ms 320ms, transform 600ms cubic-bezier(.2,.8,.2,1) 320ms; }
#chapter.on .n { opacity: 1; }
#chapter.on .rule { width: ${56 * s}px; }
#chapter.on .title { opacity: 1; transform: none; }
</style></head><body>
<div id="chapter"><span class="n"></span><span class="rule"></span><span class="title"></span></div>
${frames}
<div id="notes"></div>
<div id="overlay"></div>
<div id="caption"></div>
</body></html>`;
}

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {Record<string, string> | string[]} lines every sentence the stage will say
 * @param {{ devices: Record<string, DeviceSpot>, lang?: string, captions?: boolean,
 *   voice?: import('./voice.js').Voice | null, night?: string, accent?: string,
 *   font?: { family: string, src: string } | null,
 *   size?: { width: number, height: number } }} options size: the frame
 *   (default: the test's viewport, else 1920×1080); font: the brand's, for the
 *   chapter titles and captions (as on the cards)
 */
export async function startStage(
	browser,
	testInfo,
	lines,
	{
		devices,
		lang = 'en',
		captions = process.env.DEMO_CAPTIONS !== '0',
		voice = null,
		night = '#0b0e15',
		accent = '#c6f432',
		font = null,
		size
	}
) {
	const viewport = size ?? testInfo.project.use.viewport ?? { width: 1920, height: 1080 };
	const scale = viewport.height / 1080;
	const dir = testInfo.outputPath('stage');
	mkdirSync(dir, { recursive: true });
	const spots = Object.entries(devices).map(([name, d]) => ({ name, ...d }));

	const texts = Array.isArray(lines) ? lines : Object.values(lines);
	const spoken = voice ? await voice.prepare(texts, { lang }) : new Map();

	// Every page is created first and turned night together, as close as can
	// be: the first dark frame of each video is its marker (compose.js).
	const stageContext = await browser.newContext({
		viewport,
		recordVideo: { dir: join(dir, 'stage'), size: viewport }
	});
	const stagePage = await stageContext.newPage();
	/** @type {Record<string, { context: import('@playwright/test').BrowserContext, page: import('@playwright/test').Page }>} */
	const made = {};
	for (const d of spots) {
		const w = Math.round(d.width * scale);
		const h = Math.round(d.height * scale);
		const context = await browser.newContext({
			...(d.context ?? {}),
			viewport: { width: w, height: h },
			recordVideo: { dir: join(dir, d.name), size: { width: w, height: h } }
		});
		const zoom = (d.zoom ?? Number(process.env.DEMO_ZOOM || 1.5)) * scale;
		if (zoom !== 1) {
			await context.addInitScript((z) => {
				const apply = () => {
					document.documentElement.style.fontSize = `${16 * z}px`;
				};
				if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
				else apply();
			}, zoom);
		}
		await installCursor(context, scale);
		made[d.name] = { context, page: await context.newPage() };
	}

	const t0 = Date.now();
	/** @type {Record<string, number>} */
	const markers = {};
	const turnNight = async (
		/** @type {import('@playwright/test').Page} */ page,
		/** @type {string} */ key
	) => {
		await page.evaluate((night) => {
			document.documentElement.style.background = night;
		}, night);
		markers[key] = Date.now() - t0;
	};
	await Promise.all([
		turnNight(stagePage, 'stage'),
		...spots.map((d) => turnNight(made[d.name].page, d.name))
	]);
	await stagePage.setContent(
		stageHtml({ width: viewport.width, height: viewport.height, night, scale, spots, font })
	);
	await stagePage.evaluate(
		(a) => document.documentElement.style.setProperty('--accent', a),
		accent
	);

	/** @type {{ t: number, text: string, durationMs: number, file: string | null }[]} */
	const cues = [];
	/** @type {number | null} */
	let start = null;
	/** Stretches compose.js leaves out (cue clock, ms). @type {{ from: number, to: number }[]} */
	const cuts = [];
	const painted = (/** @type {import('@playwright/test').Page} */ page) =>
		page.evaluate(
			() =>
				new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))
		);

	return {
		provider: voice ? voice.provider() : 'none',
		devices: made,
		page: stagePage,
		cues,
		scale,
		/**
		 * Say a line: on the stage's caption bar, in the voice; wait for it.
		 * @param {string} text
		 * @param {{ hold?: number, after?: number }} [o]
		 */
		async say(text, { hold = 2200, after = 350 } = {}) {
			const v = spoken.get(text) ?? null;
			await painted(stagePage);
			cues.push({
				t: Date.now() - t0,
				text,
				durationMs: v?.durationMs ?? hold,
				file: v?.file ?? null
			});
			if (captions)
				await stagePage.evaluate((text) => {
					const bar = /** @type {HTMLElement} */ (document.getElementById('caption'));
					bar.textContent = text;
					bar.classList.toggle('on', Boolean(text));
				}, text);
			await stagePage.waitForTimeout(v ? v.durationMs + after : hold);
		},
		/**
		 * Say a line and act while it is spoken: `act` runs at once, and the
		 * stage waits for whichever ends later.
		 * @param {string} text @param {() => Promise<unknown>} act
		 */
		async sayWhile(text, act) {
			await Promise.all([this.say(text), act()]);
		},
		/** Ring the devices named (the others plain): where to look. @param {...string} names */
		async focus(...names) {
			await stagePage.evaluate((names) => {
				for (const el of document.querySelectorAll('.device'))
					el.classList.toggle('on', names.includes(el.id.slice('device-'.length)));
			}, names);
		},
		/**
		 * A note at the top of the frame, e.g. "Internet: off"; `null` takes it away.
		 * @param {string} id @param {string | null} text @param {{ kind?: 'warn' | 'ok' | '' }} [o]
		 */
		async note(id, text, { kind = '' } = {}) {
			await stagePage.evaluate(
				({ id, text, kind }) => {
					const box = /** @type {HTMLElement} */ (document.getElementById('notes'));
					let el = document.getElementById(`note-${id}`);
					if (text == null) return el?.remove();
					if (!el) {
						el = document.createElement('div');
						el.id = `note-${id}`;
						box.appendChild(el);
					}
					el.className = `note ${kind}`;
					el.textContent = text;
				},
				{ id, text, kind }
			);
		},
		/**
		 * The chapter, top left: its number, a rule and the title, animated in;
		 * the next chapter takes its place, `null` takes it away.
		 * @param {string | null} title @param {{ n?: number | string }} [o]
		 */
		async chapter(title, { n = '' } = {}) {
			await stagePage.evaluate(
				async ({ title, n }) => {
					const el = /** @type {HTMLElement} */ (document.getElementById('chapter'));
					if (el.classList.contains('on')) {
						el.classList.remove('on');
						await new Promise((r) => setTimeout(r, 380));
					}
					if (title == null) return;
					const number = /** @type {HTMLElement} */ (el.querySelector('.n'));
					number.textContent = n === '' ? '' : String(n).padStart(2, '0');
					/** @type {HTMLElement} */ (el.querySelector('.title')).textContent = title;
					void el.offsetWidth;
					el.classList.add('on');
				},
				{ title, n }
			);
		},
		/** A panel of text over the frame (a log, a proof); `null` hides it. @param {string | null} text */
		async overlay(text) {
			await stagePage.evaluate((text) => {
				const el = /** @type {HTMLElement} */ (document.getElementById('overlay'));
				el.textContent = text ?? '';
				el.classList.toggle('on', text != null);
			}, text);
		},
		/**
		 * Run `act` and leave its time out of the film: a wait the viewer need
		 * not sit through (an answer that takes a while). Nothing should be said
		 * meanwhile – a line in a cut is cut with it.
		 * @template T @param {() => Promise<T>} act @returns {Promise<T>}
		 */
		async cutWhile(act) {
			const from = Date.now() - t0;
			try {
				return await act();
			} finally {
				// A moment of the result stays in: the cut ends just before it shows.
				const to = Date.now() - t0 - 300;
				if (to > from) cuts.push({ from, to });
			}
		},
		/** Silence for a moment. */
		beat: (ms = 1200) => stagePage.waitForTimeout(ms),
		/** The picture is ready from here: compose.js cuts what comes before. */
		markStart() {
			start = Date.now() - t0;
		},
		/** @param {import('@playwright/test').Page} page @param {import('@playwright/test').Locator} locator */
		click: (page, locator, o) => click(page, locator, o),
		/** @param {import('@playwright/test').Page} page @param {import('@playwright/test').Locator} locator @param {string} text */
		type: (page, locator, text, o) => type(page, locator, text, o),
		/** @param {import('@playwright/test').Page} page @param {number} x @param {number} y */
		moveTo: (page, x, y) => moveTo(page, x, y),
		/**
		 * Close every context (which writes the videos) and write cues.json for
		 * compose.js: the stage's video, each device's video and its place.
		 * @param {{ name?: string }} [o] the film part's name (default: spec and language)
		 */
		async finish({ name } = {}) {
			name ??= `${testInfo.file.replace(/^.*\//, '').replace(/\.spec\.[cm]?js$/, '')}.${lang}`;
			const video = async (/** @type {import('@playwright/test').Page} */ page) => {
				const v = page.video();
				await page.context().close();
				return v ? await v.path() : null;
			};
			// The devices first: the stage's video, the ground of the frame, runs longest.
			const placed = [];
			for (const d of spots) {
				placed.push({
					name: d.name,
					video: await video(made[d.name].page),
					marker: markers[d.name],
					x: Math.round(d.x * scale),
					y: Math.round(d.y * scale),
					width: Math.round(d.width * scale),
					height: Math.round(d.height * scale)
				});
			}
			const stageVideo = await video(stagePage);
			writeFileSync(
				join(dir, 'cues.json'),
				JSON.stringify(
					{
						name,
						lang,
						stage: { video: stageVideo, ...viewport, devices: placed },
						marker: markers.stage,
						start,
						cuts,
						cues
					},
					null,
					2
				)
			);
		}
	};
}
