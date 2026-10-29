// A mouse pointer the viewer can see. Playwright draws none, so a recording
// shows buttons reacting to nothing. This overlay is an arrow in the page that
// glides to each target with easing and a little overshoot, sinks on the
// click, and keeps its place across a navigation (sessionStorage + an init
// script) — until `forgetThisDevice` clears that too, as it clears everything.
//
// The real input still comes from Playwright: the overlay only shows where it
// goes, and the mouse is moved there as well so hover states look right.

const ARROW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 28" width="24" height="28">
  <path d="M2 2 L2 22 L7.5 17.5 L11 25.5 L14.5 24 L11 16 L18 16 Z" fill="#0F1B2D" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`;

/** Runs in the page: creates the pointer and the animation API, once per document. */
function pageScript(arrow) {
	const KEY = 'demo.cursor';
	const start = () => {
		if (!document.body || document.getElementById('demo-cursor')) return;
		const el = document.createElement('div');
		el.id = 'demo-cursor';
		el.innerHTML = arrow;
		Object.assign(el.style, {
			position: 'fixed',
			left: '0',
			top: '0',
			width: '24px',
			height: '28px',
			zIndex: '2147483647',
			pointerEvents: 'none',
			filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))',
			transformOrigin: '2px 2px',
			willChange: 'transform'
		});
		document.body.appendChild(el);
		let pos;
		try {
			pos = JSON.parse(sessionStorage.getItem(KEY) || 'null');
		} catch {
			pos = null;
		}
		if (!pos) pos = { x: Math.round(innerWidth * 0.62), y: Math.round(innerHeight * 0.55) };
		let scale = 1;
		const paint = () => {
			el.style.transform = `translate(${pos.x}px, ${pos.y}px) scale(${scale})`;
		};
		paint();
		const ease = (t) => 1 - Math.pow(1 - t, 3); // cubic out
		/** @type {any} */ (window).__demoCursor = {
			pos: () => ({ ...pos }),
			to: (x, y, ms) =>
				new Promise((resolve) => {
					const from = { ...pos };
					const t0 = performance.now();
					// A hand overshoots a little and settles; 6 % past the target, then back.
					const over = { x: x + (x - from.x) * 0.06, y: y + (y - from.y) * 0.06 };
					const step = (now) => {
						const t = Math.min(1, (now - t0) / ms);
						const k = ease(t);
						const tx =
							t < 0.8
								? from.x + (over.x - from.x) * (k / ease(0.8))
								: over.x + (x - over.x) * ((t - 0.8) / 0.2);
						const ty =
							t < 0.8
								? from.y + (over.y - from.y) * (k / ease(0.8))
								: over.y + (y - over.y) * ((t - 0.8) / 0.2);
						pos = { x: tx, y: ty };
						paint();
						if (t < 1) requestAnimationFrame(step);
						else {
							pos = { x, y };
							paint();
							try {
								sessionStorage.setItem(KEY, JSON.stringify(pos));
							} catch {
								/* private mode: the pointer starts afresh after a navigation */
							}
							resolve(undefined);
						}
					};
					requestAnimationFrame(step);
				}),
			press: () => {
				scale = 0.82;
				paint();
			},
			release: () => {
				scale = 1;
				paint();
			}
		};
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
	else start();
}

/** @param {import('@playwright/test').BrowserContext} context */
export async function installCursor(context) {
	await context.addInitScript(pageScript, ARROW);
}

/**
 * Glide the pointer to a point and move the real mouse along.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} x
 * @param {number} y
 */
export async function moveTo(page, x, y) {
	const from = await page.evaluate(() => /** @type {any} */ (window).__demoCursor?.pos() ?? null);
	const dist = from ? Math.hypot(x - from.x, y - from.y) : 400;
	// 280 ms for a short hop, up to 750 ms across the screen.
	const ms = Math.round(Math.min(750, 280 + dist * 0.45));
	await Promise.all([
		page.evaluate(({ x, y, ms }) => /** @type {any} */ (window).__demoCursor?.to(x, y, ms), {
			x,
			y,
			ms
		}),
		page.mouse.move(x, y, { steps: 10 })
	]);
}

/**
 * A click as a person does it: glide there, sink, click, lift.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {{ settle?: number }} [options] ms to rest after the click
 */
export async function click(page, locator, { settle = 350 } = {}) {
	await locator.scrollIntoViewIfNeeded();
	const box = await locator.boundingBox();
	if (!box) throw new Error('click: the target has no box');
	// Not dead centre: a hand lands a little off, and it reads as a hand.
	const x = box.x + box.width * (0.42 + Math.random() * 0.16);
	const y = box.y + box.height * (0.42 + Math.random() * 0.16);
	await moveTo(page, x, y);
	await page.waitForTimeout(90);
	await page.evaluate(() => /** @type {any} */ (window).__demoCursor?.press());
	await locator.click();
	await page.waitForTimeout(110);
	await page.evaluate(() => /** @type {any} */ (window).__demoCursor?.release());
	await page.waitForTimeout(settle);
}

/**
 * Click into a field and type like a person, character by character.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} locator
 * @param {string} text
 * @param {{ delay?: number }} [options] ms per character
 */
export async function type(page, locator, text, { delay = 38 } = {}) {
	await click(page, locator, { settle: 120 });
	await locator.fill('');
	await page.keyboard.type(text, { delay });
	await page.waitForTimeout(250);
}
