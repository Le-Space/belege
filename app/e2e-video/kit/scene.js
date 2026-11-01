// A scene: captions, the narrator and the pointer in one place.
//
//   const scene = await startScene(page, context, LINES);   // voice made up front
//   await scene.say(LINES.intro);                            // caption + voice, waits its length
//   await scene.click(page.getByTestId('passkey-create'));   // the pointer goes there
//   await scene.finish(testInfo);                            // cues.json beside the video
//
// Every `say` is a cue: when it started (video time), what was said and how
// long the voice is. compose.mjs lays the voice files onto the video from
// these and writes the subtitles — nothing is edited by hand.
import { writeFileSync } from 'node:fs';
import { installCaptions, say as caption } from '../captions.js';
import { installCursor, click, type, moveTo } from './cursor.js';
import { prepare, provider } from './voice.mjs';

/**
 * The app is laid out for a laptop. A 1920×1080 recording of it would show a
 * small page in a wide frame, and Playwright's video never scales a page up,
 * so the page is enlarged instead: its root font size is raised (1.5× by
 * default: a 1280×720 layout in a 1080p frame; a taller frame, DEMO_RES,
 * raises it further so the layout stays the same). Tailwind sizes in rem, so
 * the whole layout follows; CSS `zoom` would do the same, but Playwright then
 * takes elements for outside the viewport and clicks nothing.
 * @param {import('@playwright/test').BrowserContext} context
 * @param {number} scale the frame's height over 1080
 */
async function installZoom(context, scale) {
	const zoom = Number(process.env.DEMO_ZOOM || 1.5) * scale;
	if (!(zoom > 0) || zoom === 1) return;
	await context.addInitScript((z) => {
		const apply = () => {
			document.documentElement.style.fontSize = `${16 * z}px`;
		};
		if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
		else apply();
	}, zoom);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').BrowserContext} context
 * @param {Record<string, string> | string[]} lines every sentence the scene will say
 * @param {{ lang?: 'en' | 'de', captions?: boolean }} [options]
 */
export async function startScene(
	page,
	context,
	lines,
	{ lang = 'en', captions = process.env.DEMO_CAPTIONS !== '0' } = {}
) {
	// The clock of the cues is this one; the video's clock is Playwright's,
	// started with the page some unknown time before here. To tie the two: the
	// blank page is turned night right now (a white-to-dark step the video
	// shows), and compose.mjs reads that frame's time off the recording and
	// shifts every cue by the difference.
	const t0 = Date.now();
	await page.evaluate(() => {
		document.documentElement.style.background = '#0b0e15';
	});
	const marker = Date.now() - t0;
	const texts = Array.isArray(lines) ? lines : Object.values(lines);
	const voice = await prepare(texts, { lang });
	// Everything the kit draws in px (captions, pointer, cards) is sized for a
	// 1080p frame; a taller frame scales it.
	const scale = (page.viewportSize()?.height ?? 1080) / 1080;
	if (captions) await installCaptions(context, scale);
	await installZoom(context, scale);
	await installCursor(context, scale);
	/** @type {{ t: number, text: string, durationMs: number, file: string | null }[]} */
	const cues = [];
	/** Video time at which the picture is ready; compose.mjs cuts what comes before. */
	let start = null;

	return {
		provider: provider(),
		cues,
		scale,
		/**
		 * Say a line: caption (if on), voice (if any), and wait for the longer of
		 * the voice and `hold` — the pause a reader needs without a voice.
		 * @param {string} text
		 * @param {{ hold?: number, after?: number }} [o] after: extra ms once the voice ends
		 */
		async say(text, { hold = 2200, after = 350 } = {}) {
			const v = voice.get(text) ?? null;
			// Stamp the cue on a painted frame, not before it: right after a
			// navigation the page may still be blank for a moment, and a voice
			// that starts over a white frame reads as a glitch.
			await page.evaluate(
				() =>
					new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))
			);
			cues.push({
				t: Date.now() - t0,
				text,
				durationMs: v?.durationMs ?? hold,
				file: v?.file ?? null
			});
			if (captions) await caption(page, text, 0, scale);
			await page.waitForTimeout(v ? v.durationMs + after : hold);
		},
		/** Silence for a moment; the viewer looks. */
		beat: (ms = 1200) => page.waitForTimeout(ms),
		/**
		 * The picture is ready from here: compose.mjs cuts the recording before
		 * this point (without it: 800 ms before the first line).
		 */
		markStart() {
			start = Date.now() - t0;
		},
		click: (locator, o) => click(page, locator, o),
		type: (locator, text, o) => type(page, locator, text, o),
		moveTo: (x, y) => moveTo(page, x, y),
		/**
		 * Write cues.json next to the video; compose.mjs reads both.
		 * @param {import('@playwright/test').TestInfo} testInfo
		 * @param {{ name?: string }} [o] the clip's name in out/ (default: the spec file's, with the language)
		 */
		async finish(testInfo, { name } = {}) {
			name ??= `${testInfo.file.replace(/^.*\//, '').replace(/\.spec\.[cm]?js$/, '')}.${lang}`;
			writeFileSync(
				testInfo.outputPath('cues.json'),
				JSON.stringify({ name, lang, marker, start, cues }, null, 2)
			);
		}
	};
}
