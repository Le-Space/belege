// A fake customer portal ("Kundenportal") on 127.0.0.1, for tests only. It is
// built from the same public assumptions as the Vodafone MeinKabel recipe
// (src/portals/recipes/vodafone-meinkabel.json): a cookie banner, a login form
// (user name, password, "Angemeldet bleiben"), an optional one-time code step,
// an optional bot check, an overview, a document list with dates and PDF
// links, a logout – and, under /api, the JSON endpoints a web client calls
// with a bearer token the logged-in page holds. Every name, number and amount
// in it is made up.
//
// The session cookie lasts across browser restarts only when "Angemeldet
// bleiben" was ticked, as on real portals.

import http from 'node:http';
import { randomBytes } from 'node:crypto';

import { makePdf } from './synthetic-pdf.js';

export const FAKE_PORTAL_USER = 'kunde@example.test';
export const FAKE_PORTAL_PASSWORD = 'Portal-Passwort-7Q!x';
export const PORTAL_VENDOR = 'Vodafone West GmbH';
/** On every invoice page and in the API: proves that no page content reaches a log or a response. */
export const CUSTOMER_NUMBER = 'KD-SECRET-000123456';
export const FAKE_API_KEY = 'fake-public-api-key';
const CONTRACT = '900123456';

const MONTHS = [
	'Januar',
	'Februar',
	'März',
	'April',
	'Mai',
	'Juni',
	'Juli',
	'August',
	'September',
	'Oktober',
	'November',
	'Dezember'
];

/**
 * @typedef {object} FakeInvoice
 * @property {string} number e.g. VK-2026-0903
 * @property {string} date YYYY-MM-DD
 * @property {string} gross e.g. 39,99
 * @property {Buffer | string} [body] what the link serves; default a PDF of the invoice
 */

/**
 * The text of an invoice PDF: the labelled lines the fake LLM reads back.
 *
 * @param {FakeInvoice} inv
 */
export function portalInvoiceLines(inv) {
	const gross = Number(inv.gross.replace(',', '.'));
	const net = (gross / 1.19).toFixed(2).replace('.', ',');
	const vat = (gross - gross / 1.19).toFixed(2).replace('.', ',');
	return [
		`Anbieter: ${PORTAL_VENDOR}`,
		`Rechnungsnummer: ${inv.number}`,
		`Rechnungsdatum: ${inv.date}`,
		`Netto: ${net} EUR`,
		`USt 19%: ${vat} EUR`,
		`Brutto: ${inv.gross} EUR`,
		'Kabel Internet 250 und TV Connect'
	];
}

/**
 * Three monthly invoices, the newest in the month of `base`.
 *
 * @param {{ base?: Date }} [options]
 * @returns {FakeInvoice[]}
 */
export function sampleInvoices({ base = new Date() } = {}) {
	return [0, 1, 2].map((back) => {
		const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - back, 3));
		const ym = d.toISOString().slice(0, 7);
		return {
			number: `VK-${ym.replace('-', '')}-${String(4711 + back)}`,
			date: d.toISOString().slice(0, 10),
			gross: back === 0 ? '39,99' : '44,99'
		};
	});
}

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** @param {string} title @param {string} body @param {{ banner?: boolean }} [o] */
function page(title, body, { banner = false } = {}) {
	return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
body{font-family:sans-serif;margin:2rem}
#cookie-banner{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center}
#cookie-banner div{background:#fff;padding:2rem}
</style></head><body>
<header><a href="/meinvodafone/services/">MeinVodafone</a></header>
<main>${body}</main>
${
	banner
		? `<div id="cookie-banner" role="dialog" aria-label="Cookies"><div><p>Wir verwenden Cookies.</p>
<button type="button" onclick="document.cookie='consent=all;path=/';this.closest('#cookie-banner').remove()">Alle akzeptieren</button>
<button type="button" onclick="document.cookie='consent=necessary;path=/';this.closest('#cookie-banner').remove()">Nur notwendige</button>
</div></div>`
		: ''
}
</body></html>`;
}

/**
 * @param {object} [options]
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string | null} [options.otp] a code the login asks for, or none
 * @param {boolean} [options.captcha] a bot check on the login page
 * @param {FakeInvoice[]} [options.invoices]
 * @param {boolean} [options.api] the JSON endpoints under /api (off: only the pages work)
 */
export async function startFakePortal({
	username = FAKE_PORTAL_USER,
	password = FAKE_PORTAL_PASSWORD,
	otp = null,
	captcha = false,
	invoices = sampleInvoices(),
	api = true
} = {}) {
	/** @type {Set<string>} */
	const sessions = new Set();
	/** @type {Map<string, string>} API bearer token → session */
	const tokens = new Map();
	/** @type {Map<string, boolean>} pending one-time-code logins → remember */
	const pending = new Map();
	const state = {
		otp,
		captcha,
		invoices,
		/** @type {{ usernameOk: boolean, passwordOk: boolean, remember: boolean }[]} */
		logins: [],
		/** @type {string[]} */
		consent: [],
		downloads: 0,
		api,
		/** @type {{ path: string, authorized: boolean }[]} */
		apiCalls: [],
		logouts: 0,
		/** @type {string[]} method and path of every request */
		requests: /** @type {string[]} */ ([])
	};

	/** @param {http.IncomingMessage} req */
	const cookies = (req) =>
		Object.fromEntries(
			String(req.headers.cookie ?? '')
				.split(';')
				.map((c) => c.trim().split('='))
				.filter(([k]) => k)
		);

	/** @param {http.IncomingMessage} req */
	const loggedIn = (req) => sessions.has(cookies(req).sid ?? '');

	/** @param {http.IncomingMessage} req @returns {Promise<URLSearchParams>} */
	const form = (req) =>
		new Promise((resolve) => {
			let raw = '';
			req.setEncoding('utf8');
			req.on('data', (d) => (raw += d));
			req.on('end', () => resolve(new URLSearchParams(raw)));
		});

	/** @param {http.ServerResponse} res @param {string} html @param {number} [status] @param {Record<string, string | string[]>} [headers] */
	const html = (res, html, status = 200, headers = {}) => {
		res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
		res.end(html);
	};
	/** @param {http.ServerResponse} res @param {string} to @param {Record<string, string | string[]>} [headers] */
	const redirect = (res, to, headers = {}) => {
		res.writeHead(302, { Location: to, ...headers });
		res.end();
	};

	/** @param {boolean} remember */
	function newSession(remember) {
		const sid = randomBytes(16).toString('hex');
		sessions.add(sid);
		tokens.set(randomBytes(16).toString('hex'), sid);
		return `sid=${sid}; Path=/; HttpOnly; SameSite=Lax${remember ? '; Max-Age=2592000' : ''}`;
	}

	/** @param {http.IncomingMessage} req @param {string} [error] */
	function loginPage(req, error) {
		const banner = !cookies(req).consent;
		return page(
			'Login | MeinVodafone',
			`<h1>Login für MeinVodafone</h1>
${error ? `<p role="alert" class="error">${esc(error)}</p>` : ''}
<form method="post" action="/meinvodafone/account/login">
<p><label for="txtUsername">Benutzername oder E-Mail-Adresse</label><br><input id="txtUsername" name="username" autocomplete="username"></p>
<p><label for="txtPassword">Passwort</label><br><input id="txtPassword" name="password" type="password" autocomplete="current-password"></p>
<p><label><input type="checkbox" name="remember" value="1"> Angemeldet bleiben</label></p>
${state.captcha ? '<div class="captcha-box"><p>Bitte bestätigen Sie, dass Sie kein Roboter sind.</p><label><input type="checkbox" name="captcha" value="solved"> Ich bin kein Roboter</label></div>' : ''}
<button type="submit">Anmelden</button>
</form>`,
			{ banner }
		);
	}

	/** What the web client does once logged in: ask the API with its token. @param {http.IncomingMessage} req */
	function apiScript(req) {
		if (!state.api) return '';
		const sid = cookies(req).sid;
		const token = [...tokens].find(([, s]) => s === sid)?.[0];
		if (!token) return '';
		return `<script>fetch('/api/meinvodafone/v2/user/userInfo',{headers:{Authorization:'Bearer ${token}','x-api-key':'${FAKE_API_KEY}'}}).catch(()=>{})</script>`;
	}

	const nav = `<nav><a href="/meinvodafone/services/">Übersicht</a> · <a href="/meinvodafone/services/notifizierung/dokumente">Meine Rechnungen</a> · <a href="/meinvodafone/account/logout">Abmelden</a></nav>`;

	/** @param {http.IncomingMessage} req */
	function invoicesPage(req) {
		const items = state.invoices
			.map((inv) => {
				const [y, m, d] = inv.date.split('-');
				const href = `/meinvodafone/services/notifizierung/dokumente/${encodeURIComponent(inv.number)}.pdf`;
				return `<li class="rechnung"><h2>Rechnung ${MONTHS[Number(m) - 1]} ${y}</h2>
<dl><dt>Rechnungsdatum</dt><dd>${d}.${m}.${y}</dd><dt>Rechnungsnummer</dt><dd>${esc(inv.number)}</dd><dt>Rechnungsbetrag</dt><dd>${esc(inv.gross)} €</dd></dl>
<a href="${href}" automation-id="documentsInboxes_download_btn">Rechnung herunterladen</a> <a href="${href}" aria-label="Rechnung als PDF">PDF</a></li>`;
			})
			.join('\n');
		return page(
			'Meine Rechnungen | MeinVodafone',
			`${nav}<h1>Meine Rechnungen</h1><p class="contract-info">Kundennummer ${CUSTOMER_NUMBER}</p><ul class="rechnungen">${items}</ul>${apiScript(req)}`
		);
	}

	/** @param {FakeInvoice} inv */
	const fileOf = (inv) => inv.body ?? makePdf(portalInvoiceLines(inv));

	/** @param {http.ServerResponse} res @param {number} status @param {unknown} body */
	const json = (res, status, body) => {
		res.writeHead(status, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(body));
	};

	/**
	 * The web client's JSON API: bearer token of a live session and the public API key.
	 *
	 * @param {http.IncomingMessage} req
	 * @param {http.ServerResponse} res
	 * @param {string} path
	 */
	function apiRoute(req, res, path) {
		const bearer = /^Bearer (\w+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? '';
		const authorized =
			sessions.has(tokens.get(bearer) ?? '') && req.headers['x-api-key'] === FAKE_API_KEY;
		const p = decodeURIComponent(path.slice('/api'.length));
		state.apiCalls.push({ path: p, authorized });
		if (!state.api) return json(res, 404, { error: 'not found' });
		if (!authorized) return json(res, 401, { error: 'unauthorized' });
		if (p === '/meinvodafone/v2/user/userInfo') {
			return json(res, 200, { userAccountVBO: { cable: [{ id: CONTRACT, name: 'Kabel' }] } });
		}
		if (p === `/meinvodafone/v2/customer/urn:vf-de:cable:can:${CONTRACT}/invoice`) {
			return json(res, 200, {
				customerId: CUSTOMER_NUMBER,
				invoices: state.invoices.map((inv) => ({
					number: inv.number,
					date: `${inv.date}T00:00:00`,
					amount: Number(inv.gross.replace(',', '.')),
					documents: [
						{ documentId: `EVN-${inv.number}`, category: 'Einzelverbindungsnachweis' },
						{ documentId: `DOC-${inv.number}`, category: 'Rechnung' }
					]
				}))
			});
		}
		const d = new RegExp(
			`^/meinvodafone/v2/customer/${CUSTOMER_NUMBER}/invoiceDocument/DOC-(.+)$`
		).exec(p);
		const inv = d && state.invoices.find((i) => i.number === d[1]);
		if (inv) {
			state.downloads++;
			return json(res, 200, {
				customerId: CUSTOMER_NUMBER,
				documentId: `DOC-${inv.number}`,
				mime: 'application/pdf',
				data: Buffer.from(fileOf(inv)).toString('base64')
			});
		}
		return json(res, 404, { error: 'not found' });
	}

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		const path = url.pathname;
		state.requests.push(`${req.method} ${path}`);
		const consent = cookies(req).consent;
		if (consent && !state.consent.includes(consent)) state.consent.push(consent);

		if (path === '/meinvodafone/account/login' && req.method === 'GET') {
			if (loggedIn(req)) return redirect(res, '/meinvodafone/services/');
			return html(res, loginPage(req));
		}
		if (path === '/meinvodafone/account/login' && req.method === 'POST') {
			const f = await form(req);
			const attempt = {
				usernameOk: f.get('username') === username,
				passwordOk: f.get('password') === password,
				remember: f.get('remember') === '1'
			};
			state.logins.push(attempt);
			if (state.captcha && f.get('captcha') !== 'solved') {
				return html(res, loginPage(req, 'Bitte bestätigen Sie die Sicherheitsprüfung.'), 400);
			}
			if (!attempt.usernameOk || !attempt.passwordOk) {
				return html(res, loginPage(req, 'Benutzername oder Passwort ist falsch.'), 401);
			}
			if (state.otp) {
				const token = randomBytes(12).toString('hex');
				pending.set(token, attempt.remember);
				return redirect(res, '/meinvodafone/account/login/code', {
					'Set-Cookie': `pending=${token}; Path=/; HttpOnly`
				});
			}
			return redirect(res, '/meinvodafone/services/', {
				'Set-Cookie': newSession(attempt.remember)
			});
		}
		if (path === '/meinvodafone/account/login/code') {
			const token = cookies(req).pending ?? '';
			if (!pending.has(token)) return redirect(res, '/meinvodafone/account/login');
			if (req.method === 'POST') {
				const f = await form(req);
				if (f.get('code') === state.otp) {
					const remember = /** @type {boolean} */ (pending.get(token));
					pending.delete(token);
					return redirect(res, '/meinvodafone/services/', {
						'Set-Cookie': [newSession(remember), 'pending=; Path=/; Max-Age=0']
					});
				}
			}
			return html(
				res,
				page(
					'Sicherheitscode | MeinVodafone',
					`<h1>Sicherheitscode eingeben</h1><p>Wir haben Ihnen einen Code per SMS geschickt.</p>
<form method="post"><label for="code">Sicherheitscode</label> <input id="code" name="code" autocomplete="one-time-code" inputmode="numeric"> <button type="submit">Bestätigen</button></form>`
				)
			);
		}
		if (path.startsWith('/api/')) return apiRoute(req, res, path);
		if (path === '/meinvodafone/account/logout' || path === '/logout') {
			const sid = cookies(req).sid ?? '';
			sessions.delete(sid);
			for (const [token, s] of tokens) if (s === sid) tokens.delete(token);
			state.logouts++;
			return redirect(res, '/meinvodafone/account/login', {
				'Set-Cookie': 'sid=; Path=/; Max-Age=0'
			});
		}
		if (path.startsWith('/meinvodafone/services') && !loggedIn(req)) {
			return redirect(res, `/meinvodafone/account/login?goto=${encodeURIComponent(path)}`);
		}
		if (path === '/meinvodafone/services/' || path === '/meinvodafone/services') {
			return html(
				res,
				page(
					'Übersicht | MeinVodafone',
					`${nav}<h1>Willkommen in MeinVodafone</h1><p class="contract-info">Ihr Kabel-Vertrag</p>${apiScript(req)}`
				)
			);
		}
		if (path === '/meinvodafone/services/notifizierung/dokumente')
			return html(res, invoicesPage(req));
		const m = /^\/meinvodafone\/services\/notifizierung\/dokumente\/(.+)\.pdf$/.exec(path);
		if (m) {
			const inv = state.invoices.find((i) => i.number === decodeURIComponent(m[1]));
			if (!inv) return html(res, page('Nicht gefunden', '<p>Nicht gefunden</p>'), 404);
			state.downloads++;
			const body = fileOf(inv);
			const isHtml = typeof body === 'string';
			res.writeHead(200, {
				'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'application/pdf',
				'Content-Disposition': `attachment; filename="Rechnung_${inv.number}.pdf"`,
				'Content-Length': Buffer.byteLength(body)
			});
			return res.end(body);
		}
		if (path === '/') return redirect(res, '/meinvodafone/services/');
		return html(res, page('Nicht gefunden', '<p>Nicht gefunden</p>'), 404);
	});

	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		username,
		state,
		/** Every session ends, as when a portal logs you out after some days. */
		expireSessions() {
			sessions.clear();
		},
		/** @param {string | null} code */
		setOtp(code) {
			state.otp = code;
		},
		/** @param {boolean} on */
		setCaptcha(on) {
			state.captcha = on;
		},
		/** @param {boolean} on */
		setApi(on) {
			state.api = on;
		},
		/** @param {FakeInvoice[]} list */
		setInvoices(list) {
			state.invoices = list;
		},
		sessionCount: () => sessions.size,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}
