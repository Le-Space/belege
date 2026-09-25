// The recipe engine: a portal recipe is data (recipes/<portal>.json) – paths,
// selectors, login steps and extraction rules – and this file runs it. Nothing
// portal-specific lives here, so a recipe can be fixed by editing its JSON,
// and a later "Portal aufzeichnen" mode (Playwright recording the user's
// clicks in the visible window) can write or repair one: a recorded step is
// one entry of `login`, a clicked element one selector; a password field
// becomes `{ "value": "$password", "secret": true }` and is never recorded.
//
// Invoices are listed by the first strategy that works, in the recipe's order:
//   api  the portal's own JSON endpoints, called with the headers the
//        logged-in page itself sent to that host (captured per browser run,
//        in memory, never logged); no login of its own
//   dom  the download controls on the invoice page and the text around them

import { readFileSync } from 'node:fs';

import { find, present, toRegExp, waitFind } from './locate.js';

const STEP_KINDS = new Set(['click', 'fill', 'check', 'stopIf', 'outcome']);
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
 * @property {{ login: string, invoices: string, logout?: string }} paths
 * @property {Record<string, import('./locate.js').Selector[]>} selectors
 * @property {{ do: string, target?: string, value?: string, secret?: boolean, optional?: boolean, outcome?: string }[]} login
 * @property {('api' | 'dom')[]} strategies
 * @property {any} [api]
 * @property {any} dom
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

	/** @param {import('playwright').Page} page */
	async function isLoggedIn(page) {
		if (!/^https?:/.test(page.url())) return false;
		if (await find(page, sel('password'))) return false;
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
		return page.evaluate(
			({ css, downloadSource, downloadFlags, dateSource, periodSource, periodFlags }) => {
				const download = new RegExp(downloadSource, downloadFlags);
				const date = new RegExp(dateSource);
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
				css: (def.dom.downloadControls ?? [])
					.filter((/** @type {any} */ s) => 'css' in s)
					.map((/** @type {any} */ s) => s.css),
				downloadSource: toRegExp(def.dom.downloadText).source,
				downloadFlags: toRegExp(def.dom.downloadText).flags,
				dateSource: toRegExp(def.dom.fields.date).source,
				periodSource: toRegExp(def.dom.fields.period).source,
				periodFlags: toRegExp(def.dom.fields.period).flags
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
			const fields = parseRow(def.dom.fields, row.text);
			return {
				key: fields.invoiceNumber ?? fields.date ?? fields.period ?? `row-${row.index}`,
				...fields,
				downloadRef: {
					kind: 'dom',
					index: row.index,
					href: sameSite(row.href) ? row.href : null
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
			await step('invoices.open', () => page.goto(url(def.paths.invoices)));
			/** @type {any[]} */
			let rows = [];
			for (const strategy of def.strategies) {
				try {
					rows = strategy === 'api' ? await listByApi(page) : await listByDom(page, step);
					log(`strategy ${strategy}: ${rows.length} invoice(s)`);
					if (rows.length > 0 || strategy === def.strategies.at(-1)) break;
				} catch (/** @type {any} */ error) {
					if (strategy === def.strategies.at(-1)) throw error;
					log(
						`strategy ${strategy} unavailable (${error?.noApi ? 'no api headers seen' : (error?.status ?? error?.name ?? 'Error')}${error?.path ? ` at ${error.path}` : ''})`
					);
				}
			}
			if (!def.verified && rows.length === 0) await trace(page, log);
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
				const res = await page.context().request.get(ref.href, { timeout: 60_000 });
				if (Number(res.headers()['content-length'] ?? 0) > maxBytes) throw tooLarge();
				if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
				return res.body();
			}
			// No plain link: click it where it is and take the download.
			let control = page.locator(`[data-belege-download="${ref.index}"]`);
			if ((await control.count()) === 0) {
				await page.goto(url(def.paths.invoices));
				await scan(page);
				control = page.locator(`[data-belege-download="${ref.index}"]`);
			}
			const [download] = await Promise.all([
				page.waitForEvent('download', { timeout: 60_000 }),
				control.click()
			]);
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
