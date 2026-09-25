// The recipe engine: a portal recipe is data (recipes/<portal>.json) – paths,
// selectors, login steps and extraction rules – and this file runs it. Nothing
// portal-specific lives here, so a recipe can be fixed by editing its JSON.
// "Portal aufzeichnen" (./recorder.js) adds to one: the clicks the user made
// in the visible window from the start page to the invoice list become the
// recipe's `route`, the control that downloaded an invoice goes first in
// `dom.downloadControls`. Nothing on a login page and no input is recorded.
//
// The invoice list is reached by the recipe's `route` when it has one (open
// baseUrl, then click each target in turn), else by opening paths.invoices.
// Invoices are then listed by the first strategy that works, in the recipe's order:
//   api  the portal's own JSON endpoints, called with the headers the
//        logged-in page itself sent to that host (captured per browser run,
//        in memory, never logged); no login of its own
//   dom  the download controls on the invoice page and the text around them
//
// A recorded route may leave the portal's site (an invoice page on
// invoice.stripe.com): a step then names its `host`, and a click that opens a
// new window follows it there. Hosts other than the site's are only visited
// when the recipe lists them in `allowedHosts` (the user confirmed each one
// after recording); a recipe with `allowedHosts` has every other top-level
// navigation of the replay aborted, and a download from another host refused.

import { readFileSync } from 'node:fs';

import { find, isSelector, present, toLocator, toRegExp, waitFind } from './locate.js';

const STEP_KINDS = new Set(['click', 'fill', 'check', 'stopIf', 'stopUnless', 'outcome']);
const HOST = /^(?=.{1,253}$)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*$/;
const MONTHS = [
	'januar',
	'februar',
	'märz',
	'april',
	'mai',
	'juni',
	'juli',
	'august',
	'september',
	'oktober',
	'november',
	'dezember'
];

/**
 * @typedef {object} RecipeDefinition
 * @property {string} id
 * @property {string} name
 * @property {string} version
 * @property {boolean} [verified]
 * @property {string} baseUrl
 * @property {{ login: string, invoices: string, logout?: string, start?: string }} paths start: where a route and a recording begin (default baseUrl)
 * @property {Record<string, import('./locate.js').Selector[]>} selectors
 * @property {{ do: string, target?: string, value?: string, secret?: boolean, optional?: boolean, outcome?: string }[]} login
 * @property {('api' | 'dom')[]} strategies
 * @property {any} [api]
 * @property {any} dom
 * @property {{ do: 'click', target: import('./locate.js').Selector, host?: string }[]} [route] recorded: from the start page to the invoice
 * @property {{ at: string, steps: any[] }} [recorded] what was recorded, for review
 * @property {string[]} [allowedHosts] other hosts the replay may visit (confirmed by the user)
 * @property {{ name: string, baseUrl: string, start: string }} [local] a portal made with "Neues Portal aufzeichnen" (./local.js)
 */

/**
 * Reads a recipe file next to this one.
 *
 * @param {string} file e.g. vodafone-meinkabel.json
 * @returns {RecipeDefinition}
 */
export function loadDefinition(file) {
	const def = JSON.parse(readFileSync(new URL(`./recipes/${file}`, import.meta.url), 'utf8'));
	validateDefinition(def);
	return def;
}

/**
 * Throws on a recipe the engine cannot run; says where.
 *
 * @param {any} def
 */
export function validateDefinition(def) {
	/** @param {boolean} ok @param {string} what */
	const need = (ok, what) => {
		if (!ok) throw new Error(`Recipe ${def?.id ?? '?'}: ${what}`);
	};
	need(typeof def?.id === 'string' && /^[a-z0-9-]{1,40}$/.test(def.id), 'id');
	need(typeof def.name === 'string' && typeof def.version === 'string', 'name and version');
	need(/^https:\/\//.test(def.baseUrl), 'baseUrl must be https');
	need(typeof def.paths?.login === 'string' && typeof def.paths?.invoices === 'string', 'paths');
	for (const target of ['password', 'loggedIn', 'captcha', 'otp']) {
		need(Array.isArray(def.selectors?.[target]), `selectors.${target}`);
	}
	need(Array.isArray(def.login) && def.login.length > 0, 'login steps');
	for (const [i, step] of def.login.entries()) {
		need(STEP_KINDS.has(step.do), `login[${i}].do`);
		if (step.target) need(Array.isArray(def.selectors[step.target]), `login[${i}].target`);
		if (step.value === '$password') need(step.secret === true, `login[${i}] must be secret`);
		if (typeof step.value === 'string' && step.value.startsWith('$')) {
			need(['$username', '$password'].includes(step.value), `login[${i}].value`);
		}
	}
	need(
		Array.isArray(def.strategies) &&
			def.strategies.length > 0 &&
			def.strategies.every((/** @type {string} */ s) => s === 'api' || s === 'dom'),
		'strategies'
	);
	if (def.strategies.includes('api')) need(/^https:\/\//.test(def.api?.base), 'api.base');
	if (def.route !== undefined) {
		need(Array.isArray(def.route) && def.route.length <= 40, 'route');
		for (const [i, step] of def.route.entries()) {
			need(
				step?.do === 'click' &&
					isSelector(step.target) &&
					(step.host === undefined ||
						(HOST.test(step.host) && def.allowedHosts?.includes(step.host))),
				`route[${i}]`
			);
		}
	}
	if (def.allowedHosts !== undefined) {
		need(
			Array.isArray(def.allowedHosts) &&
				def.allowedHosts.length <= 10 &&
				def.allowedHosts.every((/** @type {unknown} */ h) => typeof h === 'string' && HOST.test(h)),
			'allowedHosts'
		);
	}
	need(Boolean(def.dom?.fields && def.dom?.downloadText), 'dom');
}

/** `a.b.c` of an object; undefined on the way. @param {any} obj @param {string} path */
export function pick(obj, path) {
	return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** 2026-09-03, 2026-09-03T…, 03.09.2026 → 2026-09-03. @param {unknown} v */
function isoDay(v) {
	const s = String(v ?? '');
	const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
	if (iso) return iso[1];
	const de = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(s);
	return de ? `${de[3]}-${de[2]}-${de[1]}` : null;
}

/**
 * One row's text → the invoice's fields, by the recipe's DOM rules.
 *
 * @param {Record<string, import('./locate.js').Pattern>} fields
 * @param {string} text
 */
export function parseRow(fields, text) {
	const d = toRegExp(fields.date).exec(text);
	const date = d ? `${d[3]}-${d[2]}-${d[1]}` : null;
	const p = toRegExp(fields.period).exec(text);
	const period = p
		? `${p[2]}-${String(MONTHS.indexOf(p[1].toLowerCase()) + 1).padStart(2, '0')}`
		: date
			? date.slice(0, 7)
			: null;
	const a = toRegExp(fields.amount).exec(text) ?? toRegExp(fields.anyAmount).exec(text);
	const amountCents = a
		? Math.round(Number(a[1].replace(/\./g, '').replace(',', '.')) * 100)
		: null;
	const n = toRegExp(fields.invoiceNumber).exec(text);
	return { date, period, amountCents, invoiceNumber: n ? n[1] : null };
}

// ── loose fields: German and English dates and amounts, for local recipes ──

const MONTH_NAME =
	'(Jan(?:uar|uary)?|Feb(?:ruar|ruary)?|März|Maerz|Mär|Mar(?:ch)?|Apr(?:il)?|Mai|May|Jun[ei]?|Jul[iy]?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|O[ck]t(?:ober)?|Nov(?:ember)?|De[cz](?:ember)?)\\.?';
/** YYYY-MM-DD, DD.MM.YYYY, "September 3, 2026", "3. September 2026" / "3 Sep 2026". */
const LOOSE_DATES = [
	'\\b(\\d{4})-(\\d{2})-(\\d{2})\\b',
	'\\b(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})\\b',
	`\\b${MONTH_NAME}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`,
	`\\b(\\d{1,2})\\.?\\s+${MONTH_NAME}\\s+(\\d{4})\\b`
];
const LOOSE_PERIOD = `\\b${MONTH_NAME}\\s+(\\d{4})\\b`;
const CURRENCY = '(?:€|EUR|\\$|USD|£|GBP|CHF)';
const MONEY = '(-?\\d{1,3}(?:[.,\\u00a0 ]\\d{3})*[.,]\\d{2})';

/** @param {string} word */
function monthOf(word) {
	const w = word.toLowerCase().replace(/\.$/, '');
	const i = [
		'jan',
		'feb',
		'mar',
		'apr',
		'ma',
		'jun',
		'jul',
		'aug',
		'sep',
		'o',
		'nov',
		'de'
	].findIndex((p, n) =>
		n === 2
			? /^(mär|maerz|mar)/.test(w)
			: n === 4
				? w === 'mai' || w === 'may'
				: n === 9
					? /^o[ck]t/.test(w)
					: n === 11
						? /^de[cz]/.test(w)
						: w.startsWith(p)
	);
	return i + 1;
}

/** "1.039,99" / "1,039.99" / "20.00" → cents. @param {string} s */
function cents(s) {
	const t = s.replace(/[\u00a0 ]/g, '');
	const neg = t.startsWith('-');
	const digits = t.replace(/^-/, '');
	const whole = digits.slice(0, -3).replace(/[.,]/g, '');
	return (neg ? -1 : 1) * (Number(whole) * 100 + Number(digits.slice(-2)));
}

/**
 * One row's text → the invoice's fields, for a recipe without its own rules:
 * the first date and the labelled total (else the first amount) in German or
 * English formats.
 *
 * @param {string} text
 */
export function parseLooseRow(text) {
	/** @type {string | null} */
	let date = null;
	for (const [i, source] of LOOSE_DATES.entries()) {
		const m = new RegExp(source, 'i').exec(text);
		if (!m) continue;
		const [y, mo, d] =
			i === 0
				? [m[1], Number(m[2]), Number(m[3])]
				: i === 1
					? [m[3], Number(m[2]), Number(m[1])]
					: i === 2
						? [m[3], monthOf(m[1]), Number(m[2])]
						: [m[3], monthOf(m[2]), Number(m[1])];
		if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
			date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
			break;
		}
	}
	const p = date ? null : new RegExp(LOOSE_PERIOD, 'i').exec(text);
	const period = date
		? date.slice(0, 7)
		: p
			? `${p[2]}-${String(monthOf(p[1])).padStart(2, '0')}`
			: null;
	const labelled = new RegExp(
		`(?:Rechnungsbetrag|Gesamtbetrag|Gesamt|Summe|Betrag|Total|Amount(?: due| paid)?)\\s*:?\\s*(?:${CURRENCY}\\s?${MONEY}|${MONEY}\\s?${CURRENCY})`,
		'i'
	).exec(text);
	const any = new RegExp(`${CURRENCY}\\s?${MONEY}|${MONEY}\\s?${CURRENCY}`, 'i').exec(text);
	const a = labelled ?? any;
	const amount = a ? (a[1] ?? a[2]) : null;
	const n =
		/(?:Rechnungs(?:nummer|nr\.?)|Invoice\s*(?:number|no\.?|#)|Beleg(?:nummer|nr\.?)|Receipt\s*(?:number|#))\s*[:#]?\s*([A-Z0-9][A-Z0-9/-]{3,30})/i.exec(
			text
		);
	return {
		date,
		period,
		amountCents: amount ? Math.abs(cents(amount)) : null,
		invoiceNumber: n ? n[1] : null
	};
}

/** @param {string} s */
const safeId = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80);

/**
 * A path with every segment that could name the user (customer and contract
 * numbers, ids, tokens) replaced by `{id}`. The query is dropped.
 *
 * @param {string} pathname
 */
export function maskPath(pathname) {
	return pathname
		.split('/')
		.map((seg) => (/\d{3,}|[A-Za-z0-9_-]{24,}|:/.test(seg) ? '{id}' : seg))
		.join('/');
}

/** @param {string} template @param {Record<string, string>} values */
const fill = (template, values) =>
	template.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(values[k] ?? ''));

/**
 * @param {RecipeDefinition} def
 * @param {{ baseUrl?: string, apiBaseUrl?: string }} [overrides] loopback test servers only (portals/index.js)
 */
export function createRecipe(def, { baseUrl = def.baseUrl, apiBaseUrl = def.api?.base } = {}) {
	const base = new URL(baseUrl);
	const apiBase = apiBaseUrl ? new URL(apiBaseUrl) : null;
	const url = (/** @type {string} */ path) => new URL(path, base).toString();
	const S = def.selectors;
	const sel = (/** @type {string} */ name) => S[name] ?? [];
	const forward = new Set(
		(def.api?.forwardHeaders ?? []).map((/** @type {string} */ h) => h.toLowerCase())
	);

	/** Per browser context: the headers the page sent to the API host. */
	const captured = new WeakMap();
	/** Per browser context, unverified recipes only: the requests the page made, masked. */
	const seen = new WeakMap();
	/** Browser contexts whose top-level navigations are held to the site and allowedHosts. */
	const guarded = new WeakSet();
	const allowedHosts = new Set(def.allowedHosts ?? []);
	const startUrl = def.paths.start ? url(def.paths.start) : base.toString();
	const loose = def.dom.fields?.loose === true;

	/** @param {string} href */
	function onApiHost(href) {
		if (!apiBase) return false;
		try {
			const u = new URL(href);
			return (
				u.origin === apiBase.origin && u.pathname.startsWith(apiBase.pathname.replace(/\/$/, ''))
			);
		} catch {
			return false;
		}
	}

	/** @param {string | null} href */
	function sameSite(href) {
		if (!href) return false;
		try {
			const u = new URL(href);
			const root = base.hostname.replace(/^www\./, '');
			return (
				(u.protocol === 'https:' || (u.protocol === 'http:' && base.protocol === 'http:')) &&
				(u.hostname === base.hostname || u.hostname === root || u.hostname.endsWith(`.${root}`))
			);
		} catch {
			return false;
		}
	}

	/**
	 * The site's own hosts, or one the user confirmed for this recipe.
	 *
	 * @param {string | null} href
	 */
	function allowed(href) {
		if (sameSite(href)) return true;
		try {
			const u = new URL(String(href));
			return (
				(u.protocol === 'https:' || (u.protocol === 'http:' && base.protocol === 'http:')) &&
				allowedHosts.has(u.hostname)
			);
		} catch {
			return false;
		}
	}

	/**
	 * Aborts every top-level navigation of this context to a host that is not
	 * allowed; subresources (scripts, frames of a payment provider) pass. Only
	 * for recipes that carry `allowedHosts`, only while invoices are fetched.
	 *
	 * @param {import('playwright').BrowserContext} context
	 */
	async function guard(context) {
		if (!def.allowedHosts || guarded.has(context)) return;
		guarded.add(context);
		await context.route(
			(u) => /^https?:$/.test(u.protocol) && !allowed(u.href),
			async (route) => {
				const request = route.request();
				let top = request.isNavigationRequest();
				try {
					top &&= request.frame().parentFrame() === null;
				} catch {
					// A new window's first navigation has no frame yet: it is a top-level one.
				}
				if (top) return route.abort('blockedbyclient');
				return route.continue();
			}
		);
	}

	/**
	 * What says "logged in" on a recipe without `loggedIn` selectors (a local
	 * one): the first recorded control, else the recorded download control.
	 */
	const sessionMarks = () => {
		const first = def.route?.[0];
		if (first && !first.host) return [first.target];
		return (def.dom.downloadControls ?? []).slice(0, 1);
	};

	/** @param {import('playwright').Page} page */
	async function isLoggedIn(page) {
		if (!/^https?:/.test(page.url())) return false;
		if (await find(page, sel('password'))) return false;
		if (sel('loggedIn').length === 0) {
			const marks = sessionMarks();
			return marks.length > 0 && Boolean(await waitFind(page, marks, 5_000));
		}
		return present(page, sel('loggedIn'));
	}

	/** @param {import('playwright').Page} page */
	async function outcome(page) {
		const end = Date.now() + 15_000;
		while (Date.now() < end) {
			if (await isLoggedIn(page)) return 'logged-in';
			if (await find(page, sel('captcha'))) return 'captcha';
			if (await find(page, sel('otp'))) return 'otp';
			if (await find(page, sel('loginError'))) return 'rejected';
			await page.waitForTimeout(300);
		}
		return 'unknown';
	}

	/** @param {import('playwright').Page} page */
	async function rejectCookies(page) {
		const button = await find(page, sel('cookieReject'));
		if (button) await button.click({ timeout: 5_000 }).catch(() => {});
	}

	// ── dom strategy ──────────────────────────────────────────────────────────

	/** @param {import('playwright').Page} page */
	async function scan(page) {
		// A recorded control is usually { role, name }: marked here, found by the mark below.
		const other = (def.dom.downloadControls ?? []).filter((/** @type {any} */ s) => !('css' in s));
		for (const s of other) {
			await toLocator(page, s)
				.evaluateAll((els) => els.forEach((el) => el.setAttribute('data-belege-control', '')))
				.catch(() => {});
		}
		return page.evaluate(
			({
				css,
				downloadSource,
				downloadFlags,
				dateSource,
				dateFlags,
				periodSource,
				periodFlags
			}) => {
				const download = new RegExp(downloadSource, downloadFlags);
				const date = new RegExp(dateSource, dateFlags);
				const period = new RegExp(periodSource, periodFlags);
				/** @type {Element[]} */
				const controls = [];
				for (const c of css) for (const el of document.querySelectorAll(c)) controls.push(el);
				for (const el of document.querySelectorAll('a, button, [role="button"]')) {
					const words = [
						el.textContent ?? '',
						el.getAttribute('aria-label') ?? '',
						el.getAttribute('title') ?? ''
					].join(' ');
					if (download.test(words) && !controls.includes(el)) controls.push(el);
				}
				// A row is the smallest element around a control that shows a date or a
				// month; the first control per row counts.
				/** @type {Set<Element>} */
				const rows = new Set();
				const found = [];
				for (const el of controls) {
					let row = null;
					let node = el.parentElement;
					for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
						const text = /** @type {HTMLElement} */ (node).innerText ?? '';
						if (date.test(text) || period.test(text)) {
							row = node;
							break;
						}
					}
					if (!row || rows.has(row)) continue;
					rows.add(row);
					const index = found.length;
					el.setAttribute('data-belege-download', String(index));
					const href = el instanceof HTMLAnchorElement ? el.href : null;
					found.push({ index, href, text: /** @type {HTMLElement} */ (row).innerText });
				}
				return found;
			},
			{
				css: [
					...(def.dom.downloadControls ?? [])
						.filter((/** @type {any} */ s) => 'css' in s)
						.map((/** @type {any} */ s) => s.css),
					...(other.length ? ['[data-belege-control]'] : [])
				],
				downloadSource: toRegExp(def.dom.downloadText).source,
				downloadFlags: toRegExp(def.dom.downloadText).flags,
				dateSource: loose ? LOOSE_DATES.join('|') : toRegExp(def.dom.fields.date).source,
				dateFlags: loose ? 'i' : toRegExp(def.dom.fields.date).flags,
				periodSource: loose ? LOOSE_PERIOD : toRegExp(def.dom.fields.period).source,
				periodFlags: loose ? 'i' : toRegExp(def.dom.fields.period).flags
			}
		);
	}

	/**
	 * The invoice page is a single-page app: after the document arrives it still
	 * signs in (OIDC token), then fetches the list and draws it. Scan until rows
	 * show up or the network has been quiet for a while, at most 25 s.
	 *
	 * @param {import('playwright').Page} page
	 */
	async function settledScan(page) {
		const end = Date.now() + 25_000;
		let quiet = false;
		page.waitForLoadState('networkidle', { timeout: 25_000 }).then(
			() => (quiet = true),
			() => (quiet = true)
		);
		for (;;) {
			const rows = await scan(page);
			if (rows.length > 0 || Date.now() > end) return rows;
			if (quiet) {
				// Idle once more after a short pause: a list drawn after the last request.
				await page.waitForTimeout(1_500);
				return scan(page);
			}
			await page.waitForTimeout(500);
		}
	}

	/**
	 * @param {import('playwright').Page} page
	 * @param {(name: string, fn: () => Promise<any>) => Promise<any>} step
	 */
	async function listByDom(page, step) {
		await rejectCookies(page);
		let rows = await settledScan(page);
		if (rows.length === 0) {
			const nav = await find(page, sel('invoicesNav'));
			if (nav) {
				await step('invoices.nav', () => nav.click());
				await page.waitForLoadState('domcontentloaded').catch(() => {});
				rows = await settledScan(page);
			}
		}
		for (let i = 0; i < 5; i++) {
			const more = await find(page, sel('showMore'));
			if (!more) break;
			await more.click({ timeout: 5_000 }).catch(() => {});
			await page.waitForTimeout(500);
			rows = await scan(page);
		}
		return rows.map((row) => {
			const fields = loose ? parseLooseRow(row.text) : parseRow(def.dom.fields, row.text);
			return {
				key: fields.invoiceNumber ?? fields.date ?? fields.period ?? `row-${row.index}`,
				...fields,
				downloadRef: {
					kind: 'dom',
					index: row.index,
					href: allowed(row.href) ? row.href : null,
					// The window the list is in (a route may have opened another one); memory only.
					page
				}
			};
		});
	}

	/**
	 * For a recipe still being fitted to its portal: where the browser ended up,
	 * which requests the page made, and which controls could be about invoices.
	 * Paths are masked and digits in labels are replaced; no page text, no
	 * header, no body is logged.
	 *
	 * @param {import('playwright').Page} page
	 * @param {(line: string) => void} log
	 */
	async function trace(page, log) {
		const here = /^https?:/.test(page.url()) ? new URL(page.url()) : null;
		log(`trace: page ${here ? `${here.host}${maskPath(here.pathname)}` : '(none)'}`);
		const controls = await page
			.evaluate((source) => {
				const about = new RegExp(source, 'i');
				const out = [];
				for (const el of document.querySelectorAll('a, button, [role="button"], [role="tab"]')) {
					const label = [el.textContent, el.getAttribute('aria-label'), el.getAttribute('title')]
						.join(' ')
						.replace(/\s+/g, ' ')
						.trim();
					if (!about.test(label)) continue;
					const href = el instanceof HTMLAnchorElement ? el.pathname : '';
					out.push({ tag: el.tagName.toLowerCase(), label, href });
					if (out.length >= 25) break;
				}
				return out;
			}, 'rechnung|dokument|postfach|download|herunterladen|pdf|archiv|kundenkonto')
			.catch(() => []);
		log(`trace: ${controls.length} control(s) about invoices`);
		for (const c of controls) {
			const label = c.label.replace(/\d/g, '#').slice(0, 60);
			log(`trace:   ${c.tag} "${label}"${c.href ? ` → ${maskPath(c.href)}` : ''}`);
		}
		const lines = [...(seen.get(page.context()) ?? [])];
		log(`trace: ${lines.length} request(s) of the page`);
		for (const line of lines) log(`trace:   ${line}`);
	}

	/**
	 * A window of the context on `host`, the current one first, else the
	 * newest; waits up to 15 s for one to get there.
	 *
	 * @param {import('playwright').Page} current
	 * @param {string} host
	 */
	async function pageOn(current, host) {
		const on = (/** @type {import('playwright').Page} */ p) => {
			try {
				return new URL(p.url()).hostname === host;
			} catch {
				return false;
			}
		};
		const end = Date.now() + 15_000;
		for (;;) {
			if (on(current)) return current;
			const other = current.context().pages().filter(on).at(-1);
			if (other) return other;
			if (Date.now() > end) throw new Error(`no window on ${host}`);
			await current.waitForTimeout(250);
		}
	}

	/**
	 * To the invoice list: by the recorded route, else by its path. Returns the
	 * window the list is in: a click that opens a new window is followed there.
	 *
	 * @param {import('playwright').Page} page
	 * @param {(name: string, fn: () => Promise<any>) => Promise<any>} step
	 * @returns {Promise<import('playwright').Page>}
	 */
	async function openInvoices(page, step) {
		if (!def.route?.length) {
			await step('invoices.open', () => page.goto(url(def.paths.invoices)));
			return page;
		}
		await guard(page.context());
		await step('route.open', () => page.goto(startUrl));
		let active = page;
		for (const [i, s] of def.route.entries()) {
			await step(`route.${i + 1}`, async () => {
				if (s.host) active = await pageOn(active, s.host);
				const hit = await waitFind(active, [s.target], 15_000);
				if (!hit) throw new Error('not found');
				const before = active.url();
				const popup = active
					.context()
					.waitForEvent('page', { timeout: 2_500 })
					.catch(() => null);
				await hit.click();
				// A click that navigates: wait for the next page; one that opens a window:
				// go on there; one that does neither costs 2.5 s.
				const moved = active
					.waitForURL((u) => u.href !== before, { timeout: 2_500, waitUntil: 'domcontentloaded' })
					.then(
						() => null,
						() => null
					);
				const opened = await Promise.race([popup, moved]);
				if (opened) {
					await opened.waitForLoadState('domcontentloaded').catch(() => {});
					active = opened;
				}
			});
		}
		return active;
	}

	// ── api strategy ──────────────────────────────────────────────────────────

	/** @param {import('playwright').Page} page @param {string} path */
	async function apiGet(page, path) {
		const headers = captured.get(page.context());
		if (!headers || !apiBase) throw Object.assign(new Error('no api headers'), { noApi: true });
		const target = new URL(path.replace(/^\//, ''), apiBase.toString().replace(/\/?$/, '/'));
		if (!onApiHost(target.toString())) throw new Error('off the api host');
		const res = await page.context().request.get(target.toString(), {
			headers: { ...headers, accept: 'application/json, text/plain, */*' },
			timeout: 60_000
		});
		if (!res.ok()) {
			throw Object.assign(new Error(`HTTP ${res.status()}`), {
				status: res.status(),
				path: maskPath(target.pathname)
			});
		}
		return res;
	}

	/** @param {import('playwright').Page} page */
	async function listByApi(page) {
		const a = def.api;
		// The page asks the API itself once it shows the user's data; wait a little for it.
		for (let i = 0; i < 20 && !captured.get(page.context()); i++) await page.waitForTimeout(250);
		const info = await (await apiGet(page, a.contracts.url)).json();
		const contracts = (pick(info, a.contracts.list) ?? [])
			.map((/** @type {any} */ c) => String(pick(c, a.contracts.id) ?? ''))
			.filter(Boolean);
		const out = [];
		for (const contract of contracts) {
			const list = await (await apiGet(page, fill(a.invoices.url, { contract }))).json();
			const customer = String(pick(list, a.invoices.customer) ?? '');
			for (const inv of pick(list, a.invoices.list) ?? []) {
				const docs = pick(inv, a.invoices.documents) ?? [];
				const wanted = a.invoices.documentPick;
				const doc =
					docs.find((/** @type {any} */ d) =>
						wanted ? toRegExp(wanted).test(String(pick(d, wanted.field) ?? '')) : true
					) ?? docs[0];
				const document = doc ? String(pick(doc, a.invoices.documentId) ?? '') : '';
				if (!document || !customer) continue;
				const number = pick(inv, a.invoices.number);
				const date = isoDay(pick(inv, a.invoices.date));
				const amount = Number(pick(inv, a.invoices.amount));
				out.push({
					key: number ? String(number) : (date ?? document),
					date,
					period: date ? date.slice(0, 7) : null,
					amountCents: Number.isFinite(amount) ? Math.round(Math.abs(amount) * 100) : null,
					invoiceNumber: number ? String(number) : null,
					downloadRef: { kind: 'api', customer, document }
				});
			}
		}
		return out;
	}

	return {
		id: def.id,
		name: def.name,
		version: `${def.version}${def.verified ? '' : ' (unverified)'}`,
		loginUrl: url(def.paths.login),
		invoicesUrl: url(def.paths.invoices),
		baseUrl: base.toString(),
		/** Where a recording and a route start. */
		startUrl,
		/** @param {string | null} href a host this recipe may visit */
		allowed,
		definition: def,
		isLoggedIn,

		/**
		 * Remembers the headers the page sends to the API host, for this context only.
		 *
		 * @param {import('playwright').BrowserContext} context
		 */
		attach(context) {
			if (!def.verified) {
				/** @type {Set<string>} */
				const lines = new Set();
				seen.set(context, lines);
				context.on('response', (response) => {
					const request = response.request();
					if (!['xhr', 'fetch', 'document'].includes(request.resourceType())) return;
					if (!sameSite(response.url()) && !onApiHost(response.url())) return;
					if (lines.size >= 150) return;
					const u = new URL(response.url());
					const type = String(response.headers()['content-type'] ?? '').split(';')[0];
					lines.add(
						`${request.method()} ${u.host}${maskPath(u.pathname)} → ${response.status()} ${type}`
					);
				});
			}
			if (!apiBase || forward.size === 0) return;
			context.on('request', (request) => {
				if (!onApiHost(request.url())) return;
				const all = request.headers();
				/** @type {Record<string, string>} */
				const keep = {};
				for (const name of forward) if (all[name]) keep[name] = all[name];
				if (keep.authorization) captured.set(context, keep);
			});
		},

		/**
		 * Runs the recipe's login steps. A code or a bot check is never touched.
		 *
		 * @param {import('playwright').Page} page
		 * @param {{ username: string, password: string }} creds
		 * @param {(name: string, fn: () => Promise<any>) => Promise<any>} step
		 * @returns {Promise<string>} logged-in, otp, captcha, rejected, unknown
		 */
		async login(page, creds, step) {
			for (const s of def.login) {
				const name = `login.${s.target ?? s.do}`;
				const targets = s.target ? sel(s.target) : [];
				if (s.do === 'outcome') return step('login.outcome', () => outcome(page));
				if (s.do === 'stopIf') {
					if (await find(page, targets)) return s.outcome ?? 'unknown';
					continue;
				}
				if (s.do === 'stopUnless') {
					if (!(await waitFind(page, targets, 5_000))) return s.outcome ?? 'unknown';
					continue;
				}
				const el = s.optional
					? await find(page, targets)
					: await step(name, async () => {
							const hit = await waitFind(page, targets, 10_000);
							if (!hit) throw new Error('not found');
							return hit;
						});
				if (!el) continue;
				if (s.do === 'click') {
					await (s.optional
						? el.click({ timeout: 5_000 }).catch(() => {})
						: step(name, () => el.click()));
				} else if (s.do === 'check') {
					await (s.optional
						? el.check({ timeout: 3_000 }).catch(() => {})
						: step(name, () => el.check()));
				} else if (s.do === 'fill') {
					const value =
						s.value === '$username'
							? creds.username
							: s.value === '$password'
								? creds.password
								: String(s.value ?? '');
					await step(name, () => el.fill(value));
				}
			}
			return step('login.outcome', () => outcome(page));
		},

		/**
		 * @param {import('playwright').Page} page
		 * @param {(name: string, fn: () => Promise<any>) => Promise<any>} step
		 * @param {(line: string) => void} [log]
		 */
		async listInvoices(page, step, log = () => {}) {
			const active = await openInvoices(page, step);
			/** @type {any[]} */
			let rows = [];
			for (const strategy of def.strategies) {
				try {
					rows = strategy === 'api' ? await listByApi(active) : await listByDom(active, step);
					log(`strategy ${strategy}: ${rows.length} invoice(s)`);
					if (rows.length > 0 || strategy === def.strategies.at(-1)) break;
				} catch (/** @type {any} */ error) {
					if (strategy === def.strategies.at(-1)) throw error;
					log(
						`strategy ${strategy} unavailable (${error?.noApi ? 'no api headers seen' : (error?.status ?? error?.name ?? 'Error')}${error?.path ? ` at ${error.path}` : ''})`
					);
				}
			}
			if (!def.verified && rows.length === 0) await trace(active, log);
			/** @type {Set<string>} */
			const ids = new Set();
			return rows.map((row, i) => {
				let id = safeId(row.key);
				while (ids.has(id)) id = `${id}-${i}`;
				ids.add(id);
				const { key: _key, ...rest } = row;
				return { id, ...rest };
			});
		},

		/**
		 * @param {import('playwright').Page} page
		 * @param {any} ref
		 * @param {{ maxBytes: number }} limits
		 * @returns {Promise<Buffer>}
		 */
		async download(page, ref, { maxBytes }) {
			const tooLarge = () => Object.assign(new Error('too large'), { tooLarge: true });
			if (ref.kind === 'api') {
				const res = await apiGet(
					page,
					fill(def.api.document.url, { customer: ref.customer, document: ref.document })
				);
				const type = String(res.headers()['content-type'] ?? '');
				if (Number(res.headers()['content-length'] ?? 0) > maxBytes * 1.4) throw tooLarge();
				if (!type.includes('json')) return res.body();
				const data = String(pick(await res.json(), def.api.document.base64) ?? '');
				if (data.length > maxBytes * 1.4) throw tooLarge();
				return Buffer.from(data, 'base64');
			}
			if (ref.href) {
				if (!allowed(ref.href)) throw new Error('off the allowed hosts');
				const res = await page.context().request.get(ref.href, { timeout: 60_000 });
				if (Number(res.headers()['content-length'] ?? 0) > maxBytes) throw tooLarge();
				if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
				return res.body();
			}
			// No plain link: click it where it is and take the download.
			let where = ref.page && !ref.page.isClosed() ? ref.page : page;
			let control = where.locator(`[data-belege-download="${ref.index}"]`);
			if ((await control.count()) === 0) {
				where = await openInvoices(page, (_name, fn) => fn());
				await scan(where);
				control = where.locator(`[data-belege-download="${ref.index}"]`);
			}
			const [download] = await Promise.all([
				where.waitForEvent('download', { timeout: 60_000 }),
				control.click()
			]);
			if (/^https?:/.test(download.url()) && !allowed(download.url())) {
				await download.cancel().catch(() => {});
				throw new Error('a download from a host that is not allowed');
			}
			const path = await download.path();
			const { readFile, stat } = await import('node:fs/promises');
			if ((await stat(path)).size > maxBytes) throw tooLarge();
			return readFile(path);
		},

		/** Best effort: ends the session on the portal's side too. @param {import('playwright').Page} page */
		async logout(page) {
			const control = await find(page, sel('logout'));
			if (control) await control.click({ timeout: 5_000 });
			else if (def.paths.logout) await page.goto(url(def.paths.logout), { timeout: 20_000 });
		}
	};
}

/** @typedef {ReturnType<typeof createRecipe>} Recipe */
