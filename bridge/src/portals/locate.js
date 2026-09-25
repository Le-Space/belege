// Finding things on a portal's page from a list of alternatives: the first
// one that is visible wins. Recipes keep these lists in one table, so a
// changed portal is fixed by editing a line there.
//
// A selector is data (a recipe is JSON), one of
//   { css: 'input#txtUsername' }
//   { role: 'button', name: { re: '^Anmelden$', flags: 'i' } }
//   { label: { re: 'Benutzername', flags: 'i' } }
//   { placeholder: { re: 'E-Mail', flags: 'i' } }
//   { text: { re: 'kein Roboter', flags: 'i' } }
// A RegExp works in place of { re, flags } too.

/** @typedef {RegExp | { re: string, flags?: string }} Pattern */
/**
 * @typedef {{ css: string } | { role: string, name?: Pattern } | { label: Pattern } | { placeholder: Pattern } | { text: Pattern }} Selector
 */

/** @param {Pattern} p @returns {RegExp} */
export function toRegExp(p) {
	return p instanceof RegExp ? p : new RegExp(p.re, p.flags ?? '');
}

/**
 * @param {import('playwright').Page | import('playwright').Locator} scope
 * @param {Selector} s
 * @returns {import('playwright').Locator}
 */
export function toLocator(scope, s) {
	if ('css' in s) return scope.locator(s.css);
	if ('role' in s)
		return scope.getByRole(/** @type {any} */ (s.role), s.name ? { name: toRegExp(s.name) } : {});
	if ('label' in s) return scope.getByLabel(toRegExp(s.label));
	if ('placeholder' in s) return scope.getByPlaceholder(toRegExp(s.placeholder));
	return scope.getByText(toRegExp(s.text));
}

/**
 * The first visible match of any alternative, or null. Does not wait.
 *
 * @param {import('playwright').Page} page
 * @param {Selector[]} selectors
 */
export async function find(page, selectors) {
	for (const s of selectors) {
		const all = toLocator(page, s);
		const count = await all.count().catch(() => 0);
		for (let i = 0; i < Math.min(count, 5); i++) {
			const one = all.nth(i);
			if (await one.isVisible().catch(() => false)) return one;
		}
	}
	return null;
}

/**
 * Like `find`, but waits up to `timeout` ms for one to appear.
 *
 * @param {import('playwright').Page} page
 * @param {Selector[]} selectors
 * @param {number} [timeout]
 */
export async function waitFind(page, selectors, timeout = 10_000) {
	const end = Date.now() + timeout;
	for (;;) {
		const hit = await find(page, selectors);
		if (hit || Date.now() >= end) return hit;
		await page.waitForTimeout(250);
	}
}

/**
 * Attached, visible or not – e.g. a logout link inside a closed menu.
 *
 * @param {import('playwright').Page} page
 * @param {Selector[]} selectors
 */
export async function present(page, selectors) {
	for (const s of selectors) {
		if (
			(await toLocator(page, s)
				.count()
				.catch(() => 0)) > 0
		)
			return true;
	}
	return false;
}

/** The ARIA roles a recorded click may name (portals/recorder.js). */
export const CLICK_ROLES = new Set(['link', 'button', 'tab', 'menuitem']);

/** @param {unknown} p @returns {boolean} */
function isPattern(p) {
	if (p instanceof RegExp) return true;
	const q = /** @type {any} */ (p);
	if (typeof q?.re !== 'string' || q.re.length > 300) return false;
	if (q.flags !== undefined && !/^[imsu]{0,4}$/.test(q.flags)) return false;
	try {
		toRegExp(q);
		return true;
	} catch {
		return false;
	}
}

/**
 * Whether `s` has the shape of one selector: exactly one kind, a compiling pattern.
 *
 * @param {unknown} s
 * @returns {s is Selector}
 */
export function isSelector(s) {
	if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
	const o = /** @type {any} */ (s);
	const keys = Object.keys(o);
	if ('css' in o) return keys.length === 1 && typeof o.css === 'string' && o.css.length <= 200;
	if ('role' in o) {
		return (
			keys.every((k) => k === 'role' || k === 'name') &&
			typeof o.role === 'string' &&
			/^[a-z]{2,20}$/.test(o.role) &&
			(o.name === undefined || isPattern(o.name))
		);
	}
	for (const kind of ['label', 'placeholder', 'text']) {
		if (kind in o) return keys.length === 1 && isPattern(o[kind]);
	}
	return false;
}
