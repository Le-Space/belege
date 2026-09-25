// "Portal aufzeichnen": the user clicks through the portal once, in the
// bridge's own window (logged in by the persistent profile), from the start
// page to the invoice list, and downloads one invoice. What the bridge keeps
// of that is a recipe route – replayed later by the engine (./recipe.js),
// deterministically, without an LLM:
//
//   { "route": [{ "do": "click", "target": { "role": "link", "name": { "re": "^Rechnungen$", "flags": "i" } } }, …],
//     "dom": { "downloadControls": [<the control that downloaded>] },
//     "recorded": { "at": "…", "steps": [<roles, labels and masked paths, for review>] },
//     "verified": false }
//
// What is recorded, and what never is:
// - Only trusted clicks on a, button and [role=button|tab|link|menuitem] in
//   the top frame. A clicked element becomes one selector: { role, name } by
//   its accessible name (digits turned into \d+, anchored), else a stable
//   attribute ([automation-id], [data-testid], …, an #id without digits).
// - Nothing in or at an input, textarea, select or contenteditable; no
//   keystroke, no input value; nothing at all while a password field is on
//   the page (a login page): those clicks are only counted.
// - Pages as masked paths (./recipe.js maskPath), for the review only; the
//   replay clicks, it never opens a recorded URL.
// - The download: the Playwright download event, or a PDF response, after a
//   click marks that click. When the file is a PDF (by its bytes, ≤ 15 MB) it
//   is kept in memory and handed to the app as the portal's first invoice
//   once the recording is saved; Playwright's download folder is temporary.
// - Hosts: clicks and pages on other hosts than the portal's site are
//   recorded with their host (an invoice page on invoice.stripe.com, a PDF
//   from pay.stripe.com). The review lists these hosts, and the recording is
//   only saved when the user confirmed each one; they become the recipe's
//   `allowedHosts`, the only other hosts the replay visits (./recipe.js).
// - A new portal ("Neues Portal aufzeichnen", ./local.js) is logged in to in
//   the recording window itself. For those, a page also counts as a login
//   page by its address (…/login, …/signin, accounts.…) or a user-name or
//   one-time-code field, and every login page starts the route afresh: the
//   replay begins logged in, so nothing clicked before a login belongs in it.
//
// A recording is saved as a local override, <config dir>/recipes/<id>.json
// (0600), merged over the bundled recipe when the recipes are built. It is
// meant to be shareable (GET /portals/:id/recipe/export), so it is refused
// when any value holds an e-mail address, an IBAN or a run of five digits.

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFile, rm, stat } from 'node:fs/promises';

import { PortalError } from './errors.js';
import { CLICK_ROLES, isSelector } from './locate.js';
import { MAX_INVOICE_BYTES, isPdf } from './pdf.js';
import { maskPath, validateDefinition } from './recipe.js';

const BINDING = '__belegeRecorder';
const MAX_CLICKS = 50;
/** A download this long after a click belongs to it. */
const DOWNLOAD_AFTER_CLICK_MS = 15_000;
const STABLE_ATTRIBUTES = ['automation-id', 'data-testid', 'data-test-id', 'data-qa', 'data-cy'];

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/i;
const DIGITS = /\d{5,}/;
const HOST = /^(?=.{1,253}$)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})*$/;
/** For new portals: a page whose address says "login". */
const LOGIN_PATH =
	'(^|[/._-])(log-?in|sign-?in|signon|auth|oauth2?|sso|anmeld\\w*|einloggen|magic-link)([/._-]|$)';
const LOGIN_HOST = '^(login|auth|accounts?|sso|signin|id)\\.';

/**
 * @typedef {object} RecordedStep one line of the review; no page text beyond a control's name
 * @property {'click' | 'page'} kind
 * @property {string} [role] click: link, button, tab, menuitem
 * @property {string} [label] click: the name with digits as #, or the attribute selector
 * @property {boolean} [download] click: this one downloaded the invoice
 * @property {boolean} [usable] click: false when no stable selector was found; left out of the route
 * @property {string} [path] page: the masked path
 * @property {string} [host] click or page on another host than the portal's site
 */

/**
 * @typedef {object} Recording
 * @property {string} at ISO time the recording started
 * @property {(RecordedStep & { target?: import('./locate.js').Selector | null })[]} steps
 * @property {number} pausedOnLogin clicks not recorded because a password field was on the page
 * @property {boolean} download
 * @property {string | null} [downloadHost] the download came from another host than the site's
 * @property {{ bytes: Buffer, name: string } | null} [invoice] the downloaded PDF, memory only
 */

/** @param {string} s */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Holds something that names the user and must not be in a recipe. @param {string} s */
const personal = (s) => EMAIL.test(s) || IBAN.test(s);

/**
 * An accessible name → an anchored pattern where every run of digits is \d+:
 * "Rechnung vom 01.07.2026" → ^Rechnung vom \d+\.\d+\.\d+$.
 *
 * @param {string} name
 */
export function namePattern(name) {
	return { re: `^${name.split(/\d+/).map(escapeRe).join('\\d+')}$`, flags: 'i' };
}

/**
 * What the page reported about a clicked element → a selector and its review label.
 * The report comes from page script and is checked here like any input.
 *
 * @param {any} raw
 * @returns {{ role: string | null, label: string, target: import('./locate.js').Selector | null }}
 */
export function describeTarget(raw) {
	const role = typeof raw?.role === 'string' && CLICK_ROLES.has(raw.role) ? raw.role : null;
	const name = typeof raw?.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim() : '';
	if (role && name && name.length <= 80 && !personal(name)) {
		return { role, label: name.replace(/\d+/g, '#'), target: { role, name: namePattern(name) } };
	}
	const attrs = raw?.attrs && typeof raw.attrs === 'object' ? raw.attrs : {};
	for (const attr of STABLE_ATTRIBUTES) {
		const v = attrs[attr];
		if (typeof v === 'string' && /^[\w.:-]{1,80}$/.test(v) && !/\d{3,}/.test(v) && !personal(v)) {
			const css = `[${attr}="${v}"]`;
			return { role, label: css, target: { css } };
		}
	}
	const id = typeof raw?.id === 'string' ? raw.id : '';
	if (/^[A-Za-z_-]{2,60}$/.test(id)) return { role, label: `#${id}`, target: { css: `#${id}` } };
	return { role, label: '', target: null };
}

/**
 * Runs in the portal's pages (every frame, every navigation). Reports clicks
 * on controls and page loads to the bridge; reads no value, no keystroke.
 *
 * @param {{ binding: string, passwordCss: string[], strict: boolean, loginPath: string, loginHost: string }} options
 *   strict: a new portal's recording, where a login page is also known by its address
 */
function capture({ binding, passwordCss, strict, loginPath, loginHost }) {
	const CONTROLS = 'a, button, [role="button"], [role="tab"], [role="link"], [role="menuitem"]';
	const FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
	const ATTRS = ['automation-id', 'data-testid', 'data-test-id', 'data-qa', 'data-cy'];
	/** @param {any} message */
	const report = (message) => {
		const fn = /** @type {any} */ (window)[binding];
		if (typeof fn === 'function') fn(message).catch(() => {});
	};
	const onLogin = () => {
		if (document.querySelector('input[type="password"]')) return true;
		for (const css of passwordCss) {
			try {
				if (document.querySelector(css)) return true;
			} catch {
				// not a selector this browser knows
			}
		}
		if (strict) {
			if (new RegExp(loginPath, 'i').test(location.pathname)) return true;
			if (new RegExp(loginHost, 'i').test(location.hostname)) return true;
			if (
				document.querySelector(
					'input[autocomplete~="username"], input[autocomplete~="one-time-code"], input[autocomplete~="webauthn"]'
				)
			)
				return true;
		}
		return false;
	};
	/** @param {Element} el */
	const roleOf = (el) => {
		const explicit = el.getAttribute('role');
		if (explicit) return explicit;
		if (el.tagName === 'A') return el.hasAttribute('href') ? 'link' : null;
		if (el.tagName === 'BUTTON') return 'button';
		return null;
	};
	/** The accessible name, as far as a portal's controls need it. @param {Element} el */
	const nameOf = (el) => {
		const aria = el.getAttribute('aria-label');
		if (aria?.trim()) return aria;
		const by = el.getAttribute('aria-labelledby');
		if (by) {
			const text = by
				.split(/\s+/)
				.map((id) => document.getElementById(id)?.textContent ?? '')
				.join(' ');
			if (text.trim()) return text;
		}
		return el.textContent?.trim() ? el.textContent : (el.getAttribute('title') ?? '');
	};
	document.addEventListener(
		'click',
		(event) => {
			// Only the user's own clicks: a page script cannot fake these.
			if (!event.isTrusted || !(event.target instanceof Element)) return;
			if (event.target.closest(FIELDS)) return;
			const el = event.target.closest(CONTROLS);
			if (!el) return;
			if (onLogin()) return report({ paused: true });
			/** @type {Record<string, string>} */
			const attrs = {};
			for (const a of ATTRS) {
				const v = el.getAttribute(a);
				if (v) attrs[a] = v;
			}
			report({ role: roleOf(el), name: nameOf(el).slice(0, 200), attrs, id: el.id || '' });
		},
		true
	);
	const loaded = () => report({ page: location.pathname, login: onLogin() });
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loaded);
	else loaded();
}

/**
 * Starts recording in an open context. The caller opens the window, goes to
 * the start page afterwards, and closes the context when `stop` resolves.
 *
 * @param {object} options
 * @param {import('playwright').BrowserContext} options.context
 * @param {import('./recipe.js').Recipe} options.recipe
 * @param {(line: string) => void} [options.log]
 */
export async function startRecording({ context, recipe, log = () => {} }) {
	const def = recipe.definition;
	const base = new URL(recipe.baseUrl);
	const root = base.hostname.replace(/^www\./, '');
	const loginPath = def.paths.login;
	// A new portal: the user logs in in this window.
	const strict = Boolean(def.local);
	/** @type {Recording} */
	const recording = {
		at: new Date().toISOString(),
		steps: [],
		pausedOnLogin: 0,
		download: false,
		downloadHost: null,
		invoice: null
	};
	/** @type {(RecordedStep & { target?: any, time: number }) | null} */
	let lastClick = null;
	let clicks = 0;
	let ended = false;

	/** The host of an http(s) address, or null. @param {string} href */
	const hostOf = (href) => {
		try {
			const u = new URL(href);
			return /^https?:$/.test(u.protocol) ? u.hostname : null;
		} catch {
			return null;
		}
	};
	/** @param {string} host */
	const onSite = (host) => host === base.hostname || host === root || host.endsWith(`.${root}`);

	/** A login page of a new portal: what came before it is not part of the route. */
	function restart() {
		if (!strict || recording.steps.length === 0) return;
		recording.steps = [];
		lastClick = null;
		clicks = 0;
	}

	/** @param {string | null} host where the file came from */
	function markDownload(host) {
		if (ended || recording.download || !lastClick) return false;
		if (Date.now() - lastClick.time > DOWNLOAD_AFTER_CLICK_MS) return false;
		lastClick.download = true;
		recording.download = true;
		if (host && !onSite(host)) recording.downloadHost = host;
		log('recording: download seen');
		return true;
	}

	/** @param {Buffer} bytes @param {string} name */
	function keep(bytes, name) {
		if (recording.invoice || bytes.length > MAX_INVOICE_BYTES || !isPdf(bytes)) return;
		recording.invoice = { bytes, name };
		log(`recording: invoice kept (${bytes.length} bytes)`);
	}

	await context.exposeBinding(BINDING, (source, raw) => {
		// Once the invoice came, the recording is complete: later clicks are not part of it.
		if (ended || recording.download) return;
		if (source.frame !== source.page.mainFrame()) return;
		const host = hostOf(source.page.url());
		if (!host) return;
		const off = onSite(host) ? {} : { host };
		if (raw?.paused) {
			recording.pausedOnLogin++;
			restart();
			return;
		}
		if (typeof raw?.page === 'string') {
			if (raw.login) return restart();
			if (!strict && !off.host && raw.page.startsWith(loginPath)) return;
			const path = maskPath(raw.page).slice(0, 200);
			const last = recording.steps.at(-1);
			if (!(last?.kind === 'page' && last.path === path && last.host === off.host))
				recording.steps.push({ kind: 'page', path, ...off });
			return;
		}
		if (clicks >= MAX_CLICKS) return;
		clicks++;
		const d = describeTarget(raw);
		const step = {
			kind: /** @type {const} */ ('click'),
			role: d.role ?? 'element',
			label: d.label,
			download: false,
			usable: Boolean(d.target),
			target: d.target,
			...off,
			time: Date.now()
		};
		recording.steps.push(step);
		lastClick = step;
	});
	await context.addInitScript(capture, {
		binding: BINDING,
		passwordCss: (def.selectors.password ?? [])
			.filter((/** @type {any} */ s) => 'css' in s)
			.map((/** @type {any} */ s) => s.css),
		strict,
		loginPath: LOGIN_PATH,
		loginHost: LOGIN_HOST
	});

	/** @type {Promise<void>[]} files still being read */
	const reading = [];
	/** @param {import('playwright').Download} download */
	const onDownload = (download) => {
		const marked = markDownload(hostOf(download.url()) ?? hostOf(download.page().url()));
		// The recorded invoice is kept (a PDF, in memory); the file itself is deleted.
		const read = (async () => {
			// The same file may have been seen as a PDF response first.
			if (!marked && !(recording.download && !recording.invoice && !ended)) return;
			const path = await download.path();
			if ((await stat(path)).size > MAX_INVOICE_BYTES) return;
			keep(await readFile(path), download.suggestedFilename());
		})()
			.catch(() => {})
			.finally(() => download.delete().catch(() => {}));
		reading.push(read);
	};
	/** @param {import('playwright').Page} page */
	const watch = (page) => page.on('download', onDownload);
	context.pages().forEach(watch);
	context.on('page', watch);
	context.on('response', (response) => {
		const type = String(response.headers()['content-type'] ?? '').toLowerCase();
		if (!type.startsWith('application/pdf')) return;
		const marked = markDownload(hostOf(response.url()));
		if (!marked && !(recording.download && !recording.invoice)) return;
		// A PDF shown in the window rather than downloaded: its bytes, when the browser has them.
		if (Number(response.headers()['content-length'] ?? 0) > MAX_INVOICE_BYTES) return;
		reading.push(
			response
				.body()
				.then((bytes) => keep(bytes, 'rechnung.pdf'))
				.catch(() => {})
		);
	});

	return {
		recording,
		/**
		 * Ends it: waits a moment for what the page still reports.
		 *
		 * @returns {Promise<Recording>}
		 */
		async stop() {
			if (!ended) await new Promise((resolve) => setTimeout(resolve, 300));
			ended = true;
			// A download still being written: wait for it (at most 20 s), before the window closes.
			await Promise.race([
				Promise.allSettled(reading),
				new Promise((resolve) => setTimeout(resolve, 20_000))
			]);
			return recording;
		}
	};
}

/**
 * The review of a recording, as the app shows it: roles, labels, masked paths.
 *
 * @param {Recording} recording
 */
export function review(recording) {
	return {
		at: recording.at,
		download: recording.download,
		pausedOnLogin: recording.pausedOnLogin,
		steps: reviewSteps(recording),
		hosts: extraHosts(recording),
		invoice: Boolean(recording.invoice)
	};
}

/** @param {Recording} recording @returns {RecordedStep[]} */
function reviewSteps(recording) {
	return recording.steps.map((s) =>
		s.kind === 'page'
			? { kind: 'page', path: s.path, ...(s.host ? { host: s.host } : {}) }
			: {
					kind: 'click',
					role: s.role,
					label: s.label,
					download: Boolean(s.download),
					usable: Boolean(s.usable),
					...(s.host ? { host: s.host } : {})
				}
	);
}

/**
 * The other hosts than the site's that the way to the invoice passed through,
 * up to the download, and the download's own: each one needs the user's yes.
 *
 * @param {Recording} recording
 * @returns {string[]}
 */
export function extraHosts(recording) {
	const end = recording.steps.findIndex((s) => s.download);
	const upTo = end < 0 ? recording.steps : recording.steps.slice(0, end + 1);
	const hosts = new Set(upTo.map((s) => s.host).filter((h) => typeof h === 'string'));
	if (recording.downloadHost) hosts.add(recording.downloadHost);
	return [...hosts].filter((h) => HOST.test(h)).sort();
}

/**
 * A recording → the override that is saved: the route (usable clicks before
 * the download), the download control, the review, unverified.
 *
 * @param {import('./recipe.js').RecipeDefinition} def the bundled recipe
 * @param {Recording} recording
 * @param {{ hosts?: unknown }} [confirmed] the other hosts the user said yes to
 */
export function buildOverride(def, recording, { hosts } = {}) {
	const clicks = recording.steps.filter((s) => s.kind === 'click');
	const at = clicks.findIndex((s) => s.download);
	if (at < 0) {
		throw new PortalError(
			'No download was recorded: record again and download one invoice.',
			'PORTAL_RECORDING_NO_DOWNLOAD',
			422
		);
	}
	const control = clicks[at].target;
	if (!control) {
		throw new PortalError(
			'The download control has no stable name or attribute.',
			'PORTAL_RECORDING_UNUSABLE',
			422
		);
	}
	const needed = extraHosts(recording);
	const yes = new Set(Array.isArray(hosts) ? hosts : []);
	const missing = needed.filter((h) => !yes.has(h));
	if (missing.length) {
		throw new PortalError(
			`Confirm the other hosts first: ${missing.join(', ')}.`,
			'PORTAL_HOSTS_UNCONFIRMED',
			422,
			{ step: missing[0], reason: 'host' }
		);
	}
	const route = clicks
		.slice(0, at)
		.filter((s) => s.target)
		.map((s) => ({
			do: /** @type {const} */ ('click'),
			target: /** @type {any} */ (s.target),
			...(s.host ? { host: s.host } : {})
		}));
	const steps = reviewSteps(recording);
	const end = steps.findIndex((s) => s.download);
	return {
		$comment: def.local
			? 'Recorded with "Neues Portal aufzeichnen": a portal of your own. The clicks from the start page to an invoice, the control that downloaded it, and the other hosts you confirmed.'
			: 'Recorded with "Portal aufzeichnen": the clicks from baseUrl to the invoice list, and the control that downloaded an invoice. Merged over the bundled recipe.',
		id: def.id,
		// The bundled version, also when an earlier recording is replaced.
		version: `${def.version.replace(/\+rec\..*$/, '')}+rec.${recording.at.slice(0, 10)}`,
		verified: false,
		...(def.local ? { local: { ...def.local } } : {}),
		allowedHosts: needed,
		route,
		dom: { downloadControls: [control] },
		recorded: { at: recording.at, steps: steps.slice(0, end + 1) }
	};
}

/**
 * Throws PORTAL_RECIPE_REJECTED when an override is not the shape the
 * recorder writes, or when any value could name the user. `step` says where
 * (a JSON path), `reason` what: shape, email, iban, digits.
 *
 * @param {any} patch
 * @param {string} [id] the portal it must belong to
 */
export function validateOverride(patch, id) {
	/** @param {string} where @param {string} reason */
	const reject = (where, reason) => {
		throw new PortalError(
			`The recorded recipe was refused at ${where} (${reason}).`,
			'PORTAL_RECIPE_REJECTED',
			422,
			{ step: where, reason }
		);
	};
	if (!patch || typeof patch !== 'object' || Array.isArray(patch)) reject('$', 'shape');
	const allowed = new Set([
		'$comment',
		'id',
		'version',
		'verified',
		'local',
		'allowedHosts',
		'route',
		'dom',
		'recorded'
	]);
	for (const key of Object.keys(patch)) if (!allowed.has(key)) reject(key, 'shape');
	if (typeof patch.id !== 'string' || (id !== undefined && patch.id !== id)) reject('id', 'shape');
	// A portal of its own ("Neues Portal aufzeichnen") has a `local` block; a bundled one never.
	const local = patch.id.startsWith('local-');
	if (!/^[a-z0-9-]{1,40}$/.test(patch.id)) reject('id', 'shape');
	if (local !== (patch.local !== undefined)) reject('local', 'shape');
	if (local) {
		const l = patch.local;
		if (
			!l ||
			typeof l !== 'object' ||
			Object.keys(l).sort().join() !== 'baseUrl,name,start' ||
			typeof l.name !== 'string' ||
			l.name.length < 1 ||
			l.name.length > 60 ||
			typeof l.baseUrl !== 'string' ||
			!/^(https:\/\/[a-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?)$/.test(
				l.baseUrl
			) ||
			typeof l.start !== 'string' ||
			!/^\/[A-Za-z0-9/._~%-]{0,199}$/.test(l.start)
		)
			reject('local', 'shape');
	}
	if (patch.allowedHosts !== undefined) {
		if (
			!Array.isArray(patch.allowedHosts) ||
			patch.allowedHosts.length > 10 ||
			!patch.allowedHosts.every((/** @type {unknown} */ h) => typeof h === 'string' && HOST.test(h))
		)
			reject('allowedHosts', 'shape');
	}
	if (typeof patch.version !== 'string' || patch.version.length > 60) reject('version', 'shape');
	if (patch.verified !== undefined && typeof patch.verified !== 'boolean')
		reject('verified', 'shape');
	if (!Array.isArray(patch.route) || patch.route.length > 40) reject('route', 'shape');
	for (const [i, s] of patch.route.entries()) {
		const keys = Object.keys(s ?? {});
		if (
			s?.do !== 'click' ||
			!isSelector(s.target) ||
			!keys.every((k) => k === 'do' || k === 'target' || k === 'host') ||
			(s.host !== undefined && !(patch.allowedHosts ?? []).includes(s.host))
		)
			reject(`route[${i}]`, 'shape');
	}
	const controls = patch.dom?.downloadControls;
	if (
		!patch.dom ||
		Object.keys(patch.dom).length !== 1 ||
		!Array.isArray(controls) ||
		controls.length < 1 ||
		controls.length > 5 ||
		!controls.every(isSelector)
	)
		reject('dom', 'shape');
	if (patch.recorded !== undefined) {
		if (typeof patch.recorded?.at !== 'string' || !Array.isArray(patch.recorded.steps))
			reject('recorded', 'shape');
		if (patch.recorded.steps.length > 120) reject('recorded.steps', 'shape');
	}

	/** @param {unknown} v @param {string} where */
	const walk = (v, where) => {
		if (typeof v === 'string') {
			if (v.length > 500) reject(where, 'shape');
			if (EMAIL.test(v)) reject(where, 'email');
			if (IBAN.test(v)) reject(where, 'iban');
			// An origin (checked above) may carry a test server's port.
			if (DIGITS.test(v) && where !== 'local.baseUrl') reject(where, 'digits');
		} else if (Array.isArray(v)) {
			v.forEach((x, i) => walk(x, `${where}[${i}]`));
		} else if (v && typeof v === 'object') {
			for (const [k, x] of Object.entries(v)) walk(x, where === '$' ? k : `${where}.${k}`);
		} else if (!(v === null || typeof v === 'boolean' || typeof v === 'number')) {
			reject(where, 'shape');
		}
	};
	walk(patch, '$');
	return patch;
}

/**
 * The bundled recipe with a recorded override over it: route, verified and
 * version replaced, the recorded download controls before the bundled ones.
 *
 * @param {import('./recipe.js').RecipeDefinition} def
 * @param {any} patch validated
 * @returns {import('./recipe.js').RecipeDefinition}
 */
export function mergeOverride(def, patch) {
	const recorded = patch.dom.downloadControls;
	const keys = new Set(recorded.map((/** @type {any} */ s) => JSON.stringify(s)));
	const merged = {
		...def,
		version: patch.version,
		verified: patch.verified ?? false,
		route: patch.route,
		recorded: patch.recorded,
		...(patch.allowedHosts ? { allowedHosts: patch.allowedHosts } : {}),
		dom: {
			...def.dom,
			downloadControls: [
				...recorded,
				...(def.dom.downloadControls ?? []).filter(
					(/** @type {any} */ s) => !keys.has(JSON.stringify(s))
				)
			]
		}
	};
	validateDefinition(merged);
	return merged;
}

/** @param {string} dir @param {string} id */
export const overridePath = (dir, id) => join(dir, `${id}.json`);

/**
 * The saved override of a portal, validated; null when there is none.
 * Throws PORTAL_RECIPE_REJECTED on one that does not pass.
 *
 * @param {string} dir <config dir>/recipes
 * @param {string} id
 */
export function readOverride(dir, id) {
	let text;
	try {
		text = readFileSync(overridePath(dir, id), 'utf8');
	} catch (/** @type {any} */ error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
	let patch;
	try {
		patch = JSON.parse(text);
	} catch {
		throw new PortalError('The recorded recipe is not JSON.', 'PORTAL_RECIPE_REJECTED', 422, {
			step: '$',
			reason: 'shape'
		});
	}
	return validateOverride(patch, id);
}

/**
 * Writes the override, 0600, in a 0700 directory, atomically.
 *
 * @param {string} dir
 * @param {string} id
 * @param {any} patch validated
 */
export function writeOverride(dir, id, patch) {
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	if (process.platform !== 'win32') chmodSync(dir, 0o700);
	const path = overridePath(dir, id);
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(patch, null, '\t')}\n`, { mode: 0o600 });
	if (process.platform !== 'win32') chmodSync(tmp, 0o600);
	renameSync(tmp, path);
}
