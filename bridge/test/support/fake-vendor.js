// A fake vendor for "Neues Portal aufzeichnen", for tests only: a site the
// bridge ships no recipe for, on http://127.0.0.1:<port>, whose invoices are
// shown on another host, http://localhost:<port2> (as a SaaS shows its
// invoices on invoice.stripe.com and serves the PDF from pay.stripe.com).
//
// Site: a public start page ("Anmelden"), a login page (e-mail, password,
// "Passwort anzeigen", "Anmelden"), then an overview → "Einstellungen" → tab
// "Abrechnung" → rows with "Rechnung ansehen", each a link that opens the
// invoice host in a new window. Invoice host: one page per invoice under an
// unguessable token, with its number, date and amount and a button
// "Rechnung herunterladen" that downloads the PDF by script.
//
// Every name, number and amount is made up.

import http from 'node:http';
import { randomBytes } from 'node:crypto';

import { makePdf } from './synthetic-pdf.js';

export const VENDOR_USER = 'kundin@example.test';
export const VENDOR_PASSWORD = 'Vendor-Passwort-9Z!k';
export const VENDOR_NAME = 'Beispiel Cloud GmbH';
/** On the billing page: proves that no page content reaches a log, a response or a recipe. */
export const VENDOR_CUSTOMER = 'CUST-SECRET-000987654';

/**
 * @typedef {object} VendorInvoice
 * @property {string} number e.g. BC-2026-0903
 * @property {string} date YYYY-MM-DD
 * @property {string} gross e.g. 20,00
 */

/** @param {VendorInvoice} inv */
export function vendorInvoiceLines(inv) {
	return [
		`Anbieter: ${VENDOR_NAME}`,
		`Rechnungsnummer: ${inv.number}`,
		`Rechnungsdatum: ${inv.date}`,
		`Brutto: ${inv.gross} EUR`,
		'Cloud Pro, monatlich'
	];
}

/** Two monthly invoices, the newest first. @returns {VendorInvoice[]} */
export function vendorInvoices() {
	return [
		{ number: 'BC-2026-0903', date: '2026-09-03', gross: '20,00' },
		{ number: 'BC-2026-0803', date: '2026-08-03', gross: '20,00' }
	];
}

/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** @param {string} title @param {string} body */
const page = (title, body) =>
	`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><main>${body}</main></body></html>`;

/** @param {string} iso */
const german = (iso) => iso.split('-').reverse().join('.');

/**
 * @param {object} [options]
 * @param {VendorInvoice[]} [options.invoices]
 * @param {boolean} [options.publicHome] logged out, the start page is public (else it redirects to /login)
 */
export async function startFakeVendor({ invoices = vendorInvoices(), publicHome = true } = {}) {
	/** @type {Set<string>} */
	const sessions = new Set();
	/** Invoice token → invoice. */
	const tokens = new Map(invoices.map((inv) => [randomBytes(16).toString('hex'), inv]));
	const state = {
		publicHome,
		/** @type {{ usernameOk: boolean, passwordOk: boolean }[]} */
		logins: [],
		/** @type {string[]} method and path, site */
		requests: /** @type {string[]} */ ([]),
		/** @type {string[]} method and path, invoice host */
		invoiceRequests: /** @type {string[]} */ ([]),
		downloads: 0
	};

	/** @param {http.IncomingMessage} req */
	const loggedIn = (req) => {
		const sid = /(?:^|;\s*)sid=(\w+)/.exec(String(req.headers.cookie ?? ''))?.[1] ?? '';
		return sessions.has(sid);
	};
	/** @param {http.ServerResponse} res @param {string} body @param {number} [status] @param {Record<string, string>} [headers] */
	const html = (res, body, status = 200, headers = {}) => {
		res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
		res.end(body);
	};
	/** @param {http.ServerResponse} res @param {string} to @param {Record<string, string>} [headers] */
	const redirect = (res, to, headers = {}) => {
		res.writeHead(302, { Location: to, ...headers });
		res.end();
	};

	/** @type {string} */ let invoiceOrigin = '';

	const site = http.createServer(async (req, res) => {
		const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
		state.requests.push(`${req.method} ${path}`);
		if (path === '/login' && req.method === 'POST') {
			let raw = '';
			for await (const chunk of req) raw += chunk;
			const f = new URLSearchParams(raw);
			const attempt = {
				usernameOk: f.get('email') === VENDOR_USER,
				passwordOk: f.get('password') === VENDOR_PASSWORD
			};
			state.logins.push(attempt);
			if (!attempt.usernameOk || !attempt.passwordOk) {
				return html(res, loginPage('E-Mail oder Passwort ist falsch.'), 401);
			}
			const sid = randomBytes(16).toString('hex');
			sessions.add(sid);
			return redirect(res, '/', {
				'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
			});
		}
		if (path === '/login') return html(res, loginPage());
		if (path === '/') {
			if (!loggedIn(req)) {
				if (!state.publicHome) return redirect(res, '/login');
				return html(
					res,
					page(
						'Beispiel Cloud',
						'<h1>Beispiel Cloud</h1><p>Speicher für alle.</p><p><a href="/login">Anmelden</a></p>'
					)
				);
			}
			return html(
				res,
				page(
					'Übersicht | Beispiel Cloud',
					`<h1>Willkommen</h1><nav><a href="/settings">Einstellungen</a> · <a href="/logout">Abmelden</a></nav>`
				)
			);
		}
		if (path === '/logout') {
			sessions.clear();
			return redirect(res, '/', { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
		}
		if (!loggedIn(req)) return redirect(res, '/login');
		if (path === '/settings') {
			return html(
				res,
				page(
					'Einstellungen | Beispiel Cloud',
					`<h1>Einstellungen</h1><p>Angemeldet als ${esc(VENDOR_USER)}</p>
<div role="tablist"><button type="button" role="tab" onclick="location.href='/settings/billing'">Abrechnung</button></div>`
				)
			);
		}
		if (path === '/settings/billing') {
			const rows = [...tokens]
				.map(
					([token, inv]) =>
						`<li><span>Rechnung vom ${german(inv.date)}</span> <span>${esc(inv.gross)} €</span> <a href="${invoiceOrigin}/i/${token}" target="_blank" rel="noopener">Rechnung ansehen</a></li>`
				)
				.join('\n');
			return html(
				res,
				page(
					'Abrechnung | Beispiel Cloud',
					`<h1>Abrechnung</h1><p>Kundennummer ${VENDOR_CUSTOMER}</p><ul>${rows}</ul>`
				)
			);
		}
		return html(res, page('Nicht gefunden', '<p>Nicht gefunden</p>'), 404);
	});

	/** @param {string} [error] */
	function loginPage(error) {
		return page(
			'Anmelden | Beispiel Cloud',
			`<h1>Anmelden</h1>${error ? `<p role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/login">
<p><label for="email">E-Mail</label> <input id="email" name="email" type="email"></p>
<p><label for="password">Passwort</label> <input id="password" name="password" type="password">
<button type="button" onclick="const p=document.getElementById('password');p.type=p.type==='password'?'text':'password'">Passwort anzeigen</button></p>
<button type="submit">Anmelden</button></form>`
		);
	}

	const invoiceHost = http.createServer((req, res) => {
		const path = new URL(req.url ?? '/', 'http://localhost').pathname;
		state.invoiceRequests.push(`${req.method} ${path}`);
		const m = /^\/i\/([0-9a-f]{32})(\/pdf)?$/.exec(path);
		const inv = m ? tokens.get(m[1]) : undefined;
		if (!m || !inv) return html(res, page('Nicht gefunden', '<p>Nicht gefunden</p>'), 404);
		if (m[2]) {
			state.downloads++;
			const body = makePdf(vendorInvoiceLines(inv));
			res.writeHead(200, {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="Rechnung-${inv.number}.pdf"`,
				'Content-Length': body.length
			});
			return res.end(body);
		}
		return html(
			res,
			page(
				`Rechnung ${inv.number}`,
				`<section><h1>${esc(VENDOR_NAME)}</h1><p>Rechnungsnummer ${esc(inv.number)}</p><p>Rechnungsdatum ${german(inv.date)}</p><p>Betrag ${esc(inv.gross)} €</p>
<button type="button" onclick="location.href=location.pathname+'/pdf'">Rechnung herunterladen</button></section>`
			)
		);
	});

	/** @param {http.Server} server */
	const listen = (server) =>
		new Promise((resolve) =>
			server.listen(0, '127.0.0.1', () =>
				resolve(/** @type {import('node:net').AddressInfo} */ (server.address()).port)
			)
		);
	const sitePort = await listen(site);
	const invoicePort = await listen(invoiceHost);
	// Another host name than the site's: localhost, not 127.0.0.1.
	invoiceOrigin = `http://localhost:${invoicePort}`;
	/** @param {http.Server} server */
	const close = (server) =>
		new Promise((resolve) => {
			server.close(() => resolve(undefined));
			server.closeAllConnections?.();
		});
	return {
		url: `http://127.0.0.1:${sitePort}`,
		invoiceUrl: invoiceOrigin,
		state,
		/** The invoice pages' tokens: must never be in a recipe or a review. */
		tokens: [...tokens.keys()],
		/** Every session ends. */
		expireSessions() {
			sessions.clear();
		},
		/** @param {boolean} on */
		setPublicHome(on) {
			state.publicHome = on;
		},
		close: () => Promise.all([close(site), close(invoiceHost)])
	};
}
