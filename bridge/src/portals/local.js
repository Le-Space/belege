// "Neues Portal aufzeichnen": a portal the bridge does not ship, made from a
// name and a start URL (e.g. "Anthropic", https://claude.ai) and one
// recording. Its recipe lives only on this Mac, in
// <config dir>/recipes/local-<slug>.json (0600), in the shape the recorder
// writes (./recorder.js) plus a `local` block:
//
//   { "id": "local-anthropic", "version": "local+rec.2026-09-25", "verified": false,
//     "local": { "name": "Anthropic", "baseUrl": "https://claude.ai", "start": "/" },
//     "allowedHosts": ["invoice.stripe.com", "pay.stripe.com"],
//     "route": [ … ], "dom": { "downloadControls": [ … ] }, "recorded": { … } }
//
// It is merged over a generic definition (below): the start page is both the
// login page and the invoice page, the user logs in by hand in the window
// (magic links, "Mit Google anmelden", bot checks are always the user's), and
// only when a password field is on screen and credentials are stored does the
// bridge fill the first text or e-mail field before it and the password field
// and submit. Logged in means: the first recorded control is on the start
// page. Invoices are found by the recorded route and download control, their
// date and amount read in German and English formats.
//
// The id is `local-` + a slug of the name, so it never collides with a
// bundled recipe; a taken id gets -2, -3, …

import { PortalError } from './errors.js';
import { createRecipe } from './recipe.js';
import { mergeOverride } from './recorder.js';

export const LOCAL_PREFIX = 'local-';
const MAX_ID = 40;

/** Loopback origins stand in for real ones in tests only (options.allowLoopback). */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/;
const PLACEHOLDER_BASE = 'https://loopback.invalid';

/** @param {string} v */
export const isLocalId = (v) => v.startsWith(LOCAL_PREFIX);

/**
 * @param {string} message
 * @param {'name' | 'url'} reason
 */
const invalid = (message, reason) =>
	new PortalError(message, 'PORTAL_NEW_INVALID', 400, { reason, step: reason });

/**
 * A name as the portal list and a shared recipe may show it: one line, 1–60
 * characters, no e-mail address, IBAN or run of five digits.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function checkName(name) {
	const s = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
	if (!s || s.length > 60 || /[\u0000-\u001f]/.test(s)) {
		throw invalid('A name of 1–60 characters is needed.', 'name');
	}
	if (/@/.test(s) || /\d{5,}/.test(s) || /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/i.test(s)) {
		throw invalid('The name must not hold an e-mail address, an IBAN or a long number.', 'name');
	}
	return s;
}

/**
 * The start URL → its origin (the recipe's baseUrl) and path. The query and
 * the fragment are dropped: they may carry a token.
 *
 * @param {unknown} startUrl
 * @param {{ allowLoopback?: boolean }} [options]
 * @returns {{ baseUrl: string, start: string, host: string }}
 */
export function checkStart(startUrl, { allowLoopback = false } = {}) {
	let u;
	try {
		u = new URL(String(startUrl ?? '').trim());
	} catch {
		throw invalid('The start page must be an https:// address.', 'url');
	}
	const loopback = allowLoopback && LOOPBACK.test(u.origin);
	if (u.protocol !== 'https:' && !loopback) {
		throw invalid('The start page must be an https:// address.', 'url');
	}
	if (u.username || u.password || (u.port && !loopback)) {
		throw invalid('The start page must not carry a user, a password or a port.', 'url');
	}
	if (!loopback && !/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(u.hostname)) {
		throw invalid('The start page needs a host name like claude.ai.', 'url');
	}
	const start = u.pathname || '/';
	if (!/^\/[A-Za-z0-9/._~%-]{0,199}$/.test(start) || /\d{5,}/.test(start)) {
		throw invalid(
			'The start page path must be plain (letters, digits, / . _ ~ -) without a long number.',
			'url'
		);
	}
	return { baseUrl: u.origin, start, host: u.hostname };
}

/**
 * `local-` + a slug of the name (or of the host), unique among `taken`.
 *
 * @param {string} name
 * @param {string} host
 * @param {Set<string>} taken ids in use
 */
export function localId(name, host, taken) {
	/** @param {string} s */
	const slug = (s) =>
		s
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.replace(/ß/g, 'ss')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '');
	const room = MAX_ID - LOCAL_PREFIX.length - 3; // leaves room for -NN
	const base =
		(slug(name) || slug(host.replace(/^www\./, '')) || 'portal')
			.slice(0, room)
			.replace(/-+$/, '') || 'portal';
	let id = `${LOCAL_PREFIX}${base}`;
	for (let n = 2; taken.has(id); n++) id = `${LOCAL_PREFIX}${base}-${n}`;
	return id;
}

/**
 * The generic definition a local recipe is merged over.
 *
 * @param {string} id
 * @param {{ name: string, baseUrl: string, start: string }} local
 * @returns {import('./recipe.js').RecipeDefinition}
 */
export function localDefinition(id, local) {
	const button = (/** @type {string} */ re) => ({ role: 'button', name: { re, flags: 'i' } });
	return {
		id,
		name: local.name,
		version: 'local',
		verified: false,
		local: { ...local },
		baseUrl: LOOPBACK.test(local.baseUrl) ? PLACEHOLDER_BASE : local.baseUrl,
		paths: { login: local.start, invoices: local.start, start: local.start },
		selectors: {
			cookieReject: [
				button(
					'^(Nur notwendige|Nur erforderliche|Alle ablehnen|Ablehnen|Reject all|Reject|Decline|Only necessary)'
				)
			],
			// The first text or e-mail field before a password field: the user name.
			username: [
				{
					css: "xpath=//input[not(@type) or @type='text' or @type='email' or @type='tel'][following::input[@type='password']]"
				}
			],
			password: [{ css: 'input[type="password"]' }],
			submit: [
				button('^(Anmelden|Einloggen|Login|Log in|Sign in|Weiter|Continue|Next)$'),
				{ css: 'button[type="submit"]' },
				{ css: 'input[type="submit"]' }
			],
			otp: [{ css: 'input[autocomplete="one-time-code"]' }],
			captcha: [
				{ css: 'iframe[src*="captcha" i]' },
				{ css: 'iframe[src*="challenges.cloudflare.com"]' },
				{ css: 'iframe[title*="reCAPTCHA" i]' }
			],
			loginError: [
				{
					text: {
						re: '(Passwort|Zugangsdaten|password|credentials).{0,40}(falsch|ungültig|nicht korrekt|incorrect|invalid|wrong)',
						flags: 'i'
					}
				}
			],
			// None: logged in is "the first recorded control is there" (./recipe.js).
			loggedIn: [],
			logout: [
				{
					role: 'link',
					name: { re: '^(Abmelden|Ausloggen|Log out|Logout|Sign out)$', flags: 'i' }
				},
				button('^(Abmelden|Ausloggen|Log out|Logout|Sign out)$')
			]
		},
		login: [
			{ do: 'click', target: 'cookieReject', optional: true },
			{ do: 'stopIf', target: 'captcha', outcome: 'captcha' },
			// No password field (a magic link, "Mit Google anmelden", a two-step form): the user's.
			{ do: 'stopUnless', target: 'password', outcome: 'unknown' },
			{ do: 'fill', target: 'username', value: '$username', optional: true },
			{ do: 'fill', target: 'password', value: '$password', secret: true },
			{ do: 'click', target: 'submit' },
			{ do: 'outcome' }
		],
		strategies: ['dom'],
		dom: {
			downloadControls: [],
			downloadText: { re: 'herunterladen|download|\\bPDF\\b', flags: 'i' },
			fields: { loose: true }
		}
	};
}

/**
 * A local portal's recipe, from its `local` block and (once recorded) the
 * saved file. A loopback start page only with `allowLoopback` (tests).
 *
 * @param {string} id
 * @param {{ name: string, baseUrl: string, start: string }} local
 * @param {{ patch?: any, allowLoopback?: boolean }} [options] patch: the validated file
 */
export function buildLocalRecipe(id, local, { patch, allowLoopback = false } = {}) {
	const loopback = LOOPBACK.test(local.baseUrl);
	if (loopback && !allowLoopback) {
		throw new PortalError(
			'A loopback start page is for tests only.',
			'PORTAL_RECIPE_REJECTED',
			422,
			{ step: 'local.baseUrl', reason: 'shape' }
		);
	}
	const base = localDefinition(id, local);
	const def = patch ? mergeOverride(base, patch) : base;
	return createRecipe(def, loopback ? { baseUrl: local.baseUrl } : {});
}
