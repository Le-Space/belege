// The bridge's HTTP API, on 127.0.0.1 only.
//
//   GET  /health                         no token
//   POST /pair         { code }          no token → { token }
//   GET  /hibiscus/accounts              token
//   GET  /hibiscus/transactions?account=<id>&since=YYYY-MM-DD   token
//   GET  /mail/messages?since=YYYY-MM-DD[&until=YYYY-MM-DD]&scope=accounting   token
//   GET  /mail/attachment?id=<mail id>&part=<n>                   token → the bytes
//   GET  /mail/search?text=&amount=&from=a.example,b.example&around=YYYY-MM-DD&days=   token
//   POST /mail/assist  { counterparty, purpose, amount, around, days, knownDomains }   token → LLM terms, hits, pick
//   GET  /llm/status                                              token → provider, models, key present?
//   POST /extract      { text, hints, source, confirmedByUser }   token
//   GET  /rates?asset=BTC&date=YYYY-MM-DD                         token → EUR per unit, source (rates.js)
//   /portals…          customer portals (portals/routes.js)            token
//
// Guards, in this order, on every request:
//   1. Host header is 127.0.0.1:<port> or localhost:<port> (DNS rebinding)
//   2. an Origin, when there is one, is in `appOrigins` (CORS; others get 403
//      and no CORS headers, so a foreign page cannot read anything)
//   3. a bearer token whose hash is on file, except for /health and /pair
//
// What leaves the bridge about Hibiscus is limited to accounts whose IBAN ends
// in one of `hibiscus.ibanSuffixes`. Other accounts are dropped straight after
// `konto.find`, before anything else looks at them, and their transactions
// are never asked for.

import http from 'node:http';

import { HibiscusUnreachableError, PinMismatchError } from './hibiscus.js';
import { ibanAllowed, normalizeAccount, normalizeTransaction } from './normalize.js';
import { decodeMailId, isIsoDay, isPartNumber } from './mail/mime.js';
import { handlePortalRequest } from './portals/routes.js';

export const LOOPBACK = '127.0.0.1';

const DOMAIN = /^(?=.{4,100}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * `a.example,b.example` → the domains; [] for none; null when one is no domain
 * or there are more than three.
 *
 * @param {string | null} raw
 */
function domainList(raw) {
	if (!raw) return [];
	const list = raw
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
	return list.length <= 3 && list.every((d) => DOMAIN.test(d)) ? list : null;
}
const VERSION = '0.2.0';
const MAX_BODY = 4096;
/** /extract carries a receipt's text: 30 000 characters are sent on, some room for hints. */
const MAX_EXTRACT_BODY = 256 * 1024;

/**
 * @param {object} options
 * @param {import('./config.js').BridgeConfig} options.config
 * @param {ReturnType<typeof import('./pairing.js').createPairing>} options.pairing
 * @param {(() => import('./hibiscus.js').HibiscusClient) | null} options.hibiscus
 *   null when Hibiscus is not set up yet
 * @param {import('./mail/imap.js').MailClient | null} [options.mail] null when mail is not set up
 * @param {import('./llm/extract.js').Extractor | null} [options.llm] null when no LLM is set up
 * @param {() => Promise<boolean>} [options.llmKeyPresent] whether the keychain holds an API key;
 *   says yes or no, never hands the key out
 * @param {ReturnType<typeof import('./llm/assist.js').createMailAssist> | null} [options.assist]
 *   "Mit KI weitersuchen": null without mail or LLM
 * @param {import('./portals/manager.js').PortalManager | null} [options.portals] the portal connector
 * @param {ReturnType<typeof import('./rates.js').createRateService> | null} [options.rates] exchange rates
 * @param {(message: string) => void} [options.log] never gets a secret, bank data, mail or receipt text
 */
export function createBridgeServer({
	config,
	pairing,
	hibiscus,
	mail = null,
	llm = null,
	llmKeyPresent = async () => false,
	assist = null,
	portals = null,
	rates = null,
	log = () => {}
}) {
	const allowedOrigins = new Set(config.appOrigins.map((o) => o.replace(/\/$/, '')));
	const suffixes = config.hibiscus.ibanSuffixes;

	/** @type {number} */ let boundPort = 0;

	/**
	 * @param {http.ServerResponse} res
	 * @param {number} status
	 * @param {unknown} body
	 */
	function send(res, status, body) {
		const text = JSON.stringify(body);
		res.writeHead(status, {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Length': Buffer.byteLength(text),
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff'
		});
		res.end(text);
	}

	/** @param {http.IncomingMessage} req */
	function hostAllowed(req) {
		const host = String(req.headers.host ?? '').toLowerCase();
		return host === `${LOOPBACK}:${boundPort}` || host === `localhost:${boundPort}`;
	}

	/** @param {http.IncomingMessage} req */
	function bearer(req) {
		const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(String(req.headers.authorization ?? ''));
		return m ? m[1] : null;
	}

	/**
	 * @param {http.ServerResponse} res
	 * @param {Buffer} bytes
	 * @param {string} mime
	 */
	function sendBytes(res, bytes, mime) {
		res.writeHead(200, {
			'Content-Type': mime,
			'Content-Length': bytes.length,
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			// Bytes for the app to read, never a page to render here.
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'Content-Disposition': 'attachment'
		});
		res.end(bytes);
	}

	/** @param {string} what */
	function notSetUp(what) {
		return Object.assign(
			new Error(`${what} is not set up: run \`pnpm setup:${what === 'Mail' ? 'mail' : 'llm'}\`.`),
			{
				status: 503,
				code: `${what.toUpperCase()}_NOT_SET_UP`
			}
		);
	}

	/** @param {http.IncomingMessage} req @param {number} [limit] */
	function readJson(req, limit = MAX_BODY) {
		return new Promise((resolve, reject) => {
			let size = 0;
			/** @type {Buffer[]} */ const chunks = [];
			req.on('data', (/** @type {Buffer} */ c) => {
				size += c.length;
				if (size > limit) {
					reject(Object.assign(new Error('Body too large'), { status: 413 }));
					req.destroy();
				} else chunks.push(c);
			});
			req.on('end', () => {
				try {
					resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
				} catch {
					reject(Object.assign(new Error('Body is not JSON'), { status: 400 }));
				}
			});
			req.on('error', reject);
		});
	}

	/** Allowed accounts only; the rest never leaves this function. */
	async function allowedAccounts() {
		if (!hibiscus)
			throw Object.assign(new Error('Hibiscus is not set up: run setup:hibiscus.'), {
				status: 503
			});
		const all = await hibiscus().accounts();
		return all.filter((k) => ibanAllowed(k.iban, suffixes));
	}

	/**
	 * @param {http.IncomingMessage} req
	 * @param {http.ServerResponse} res
	 * @param {URL} url
	 */
	async function route(req, res, url) {
		const path = url.pathname.replace(/\/+$/, '') || '/';

		if (path === '/health' && req.method === 'GET') {
			return send(res, 200, {
				ok: true,
				service: 'belege-bridge',
				version: VERSION,
				paired: pairing.isPaired(),
				pairingOpen: pairing.hasPendingCode(),
				hibiscus: { configured: Boolean(hibiscus) },
				mail: {
					configured: Boolean(mail),
					accountingAddress: mail ? config.mail.accountingAddress : null
				},
				llm: { configured: Boolean(llm), models: llm ? llm.models : [] },
				portals: { available: Boolean(portals) }
			});
		}

		if (path === '/pair' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req));
			const token = await pairing.pair(body?.code);
			log('paired a new client');
			return send(res, 200, { token });
		}

		if (!pairing.verify(bearer(req))) {
			return send(res, 401, { error: 'unauthorized' });
		}

		if (path === '/unpair' && req.method === 'POST') {
			await pairing.revoke(bearer(req));
			log('a client unpaired itself');
			return send(res, 200, { ok: true });
		}

		if (path === '/hibiscus/accounts' && req.method === 'GET') {
			const accounts = (await allowedAccounts()).map(normalizeAccount);
			return send(res, 200, { accounts });
		}

		if (path === '/hibiscus/transactions' && req.method === 'GET') {
			const accountId = url.searchParams.get('account') ?? '';
			const since = url.searchParams.get('since') ?? '';
			if (!/^[0-9A-Za-z_-]{1,40}$/.test(accountId))
				return send(res, 400, { error: 'account is required' });
			if (!/^\d{4}-\d{2}-\d{2}$/.test(since))
				return send(res, 400, { error: 'since must be YYYY-MM-DD' });
			// Only an allowed account; any other id looks like one that does not exist.
			const account = (await allowedAccounts()).find((k) => String(k.id) === accountId);
			if (!account) return send(res, 404, { error: 'unknown account' });
			const normalized = normalizeAccount(account);
			const raw = await /** @type {() => import('./hibiscus.js').HibiscusClient} */ (
				hibiscus
			)().transactions(accountId, since);
			const transactions = raw
				// Defence in depth: nothing that Hibiscus files under another account.
				.filter((u) => u.konto_id === undefined || String(u.konto_id) === accountId)
				.map((u) => normalizeTransaction(u, normalized))
				.filter((t) => t.date === null || t.date >= since);
			return send(res, 200, { account: normalized.id, since, transactions });
		}

		if (path === '/mail/messages' && req.method === 'GET') {
			const since = url.searchParams.get('since') ?? '';
			const until = url.searchParams.get('until') || null;
			const scope = url.searchParams.get('scope') ?? 'accounting';
			if (!isIsoDay(since)) return send(res, 400, { error: 'since must be YYYY-MM-DD' });
			if (until !== null && (!isIsoDay(until) || until <= since)) {
				return send(res, 400, { error: 'until must be a later YYYY-MM-DD' });
			}
			// The only scope there is: the private mailbox is read through /mail/search alone.
			if (scope !== 'accounting') return send(res, 400, { error: 'scope must be accounting' });
			if (!mail) throw notSetUp('Mail');
			const messages = await mail.listMessages({ since, until });
			log(`listed ${messages.length} accounting mail(s)`);
			return send(res, 200, {
				scope,
				accountingAddress: config.mail.accountingAddress,
				since,
				until,
				messages
			});
		}

		if (path === '/mail/attachment' && req.method === 'GET') {
			const id = url.searchParams.get('id') ?? '';
			const part = url.searchParams.get('part') ?? '';
			if (!decodeMailId(id)) return send(res, 400, { error: 'id is not a mail id' });
			if (!isPartNumber(part)) return send(res, 400, { error: 'part is not a part number' });
			if (!mail) throw notSetUp('Mail');
			const { bytes, mime } = await mail.attachment(id, part);
			return sendBytes(res, bytes, mime);
		}

		if (path === '/mail/search' && req.method === 'GET') {
			const text = (url.searchParams.get('text') ?? '').trim() || null;
			const amount = (url.searchParams.get('amount') ?? '').trim() || null;
			const from = domainList(url.searchParams.get('from'));
			if (from === null) return send(res, 400, { error: 'from must be up to 3 mail domains' });
			const around = url.searchParams.get('around') || null;
			const daysParam = url.searchParams.get('days');
			const days = daysParam === null || daysParam === '' ? 14 : Number(daysParam);
			if (!text && !amount && !from.length)
				return send(res, 400, { error: 'text, amount or from is required' });
			if (text && (text.length < 3 || text.length > 100 || /["\\\r\n]/.test(text))) {
				return send(res, 400, { error: 'text must be 3–100 plain characters' });
			}
			if (amount && !/^-?[\d.,]{1,15}$/.test(amount)) {
				return send(res, 400, { error: 'amount must look like 52,59' });
			}
			if (around !== null && !isIsoDay(around)) {
				return send(res, 400, { error: 'around must be YYYY-MM-DD' });
			}
			if (!Number.isInteger(days) || days < 0 || days > 60) {
				return send(res, 400, { error: 'days must be 0–60' });
			}
			if (!mail) throw notSetUp('Mail');
			const messages = await mail.search({ text, amount, from, around, days });
			log(`search found ${messages.length} mail(s)`);
			return send(res, 200, { messages });
		}

		if (path === '/mail/assist' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req, MAX_BODY));
			const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim() : '';
			const purpose = typeof body?.purpose === 'string' ? body.purpose : '';
			const amount = typeof body?.amount === 'string' && body.amount ? body.amount : null;
			const around = body?.around ?? null;
			const days = body?.days ?? 14;
			const knownDomains = domainList(
				Array.isArray(body?.knownDomains) ? body.knownDomains.join(',') : null
			);
			if (counterparty.length < 2 || counterparty.length > 200)
				return send(res, 400, { error: 'counterparty must be 2–200 characters' });
			if (purpose.length > 1000) return send(res, 400, { error: 'purpose is too long' });
			if (amount && !/^-?[\d.,]{1,15}$/.test(amount))
				return send(res, 400, { error: 'amount must look like 52,59' });
			if (around !== null && !isIsoDay(around))
				return send(res, 400, { error: 'around must be YYYY-MM-DD' });
			if (!Number.isInteger(days) || days < 0 || days > 60)
				return send(res, 400, { error: 'days must be 0–60' });
			if (knownDomains === null)
				return send(res, 400, { error: 'knownDomains must be up to 3 mail domains' });
			if (!mail) throw notSetUp('Mail');
			if (!llm || !assist) throw notSetUp('LLM');
			const result = await assist.search({
				counterparty,
				purpose,
				amount,
				around,
				days,
				knownDomains
			});
			log(
				`assisted search: ${result.terms.length} term(s), ${result.domains.length} domain(s), ${result.messages.length} mail(s), ${result.pick ? `pick ${result.pick.confidence}` : 'no pick'}`
			);
			return send(res, 200, result);
		}

		if (path === '/rates' && req.method === 'GET') {
			if (!rates) return send(res, 503, { error: 'exchange rates are not available' });
			const asset = url.searchParams.get('asset') ?? '';
			const date = url.searchParams.get('date') ?? '';
			if (!/^[A-Z0-9]{2,10}$/.test(asset)) return send(res, 400, { error: 'asset is required' });
			return send(res, 200, await rates.rate(asset, date));
		}

		if (path === '/llm/status' && req.method === 'GET') {
			// What the app shows under Integrationen → "KI – Beleg-Auslesen". The
			// host only (no path, no query, no user:password@), the model names, and
			// whether a key is there – never the key, never the terms themselves.
			let provider = null;
			try {
				provider = new URL(config.llm.baseUrl).host || null;
			} catch {}
			let keyConfigured = false;
			try {
				keyConfigured = (await llmKeyPresent()) === true;
			} catch {}
			return send(res, 200, {
				configured: Boolean(llm),
				provider,
				models: {
					primary: config.llm.model || null,
					fallback:
						config.llm.retryModel && config.llm.retryModel !== config.llm.model
							? config.llm.retryModel
							: null
				},
				keyConfigured,
				redactTerms: config.llm.redactTerms.length,
				mail: { authServId: config.mail.authServId ?? null }
			});
		}

		if (path === '/extract' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req, MAX_EXTRACT_BODY));
			if (typeof body?.text !== 'string' || !body.text.trim()) {
				return send(res, 400, { error: 'text is required' });
			}
			/** @type {Record<string, string>} */
			const hints = {};
			for (const k of ['subject', 'from', 'fileName', 'receivedAt']) {
				if (typeof body.hints?.[k] === 'string') hints[k] = body.hints[k];
			}
			const mailId = body.source?.mailId;
			if (mailId !== undefined && mailId !== null) {
				if (!decodeMailId(mailId))
					return send(res, 400, { error: 'source.mailId is not a mail id' });
				if (!mail) throw notSetUp('Mail');
				// The bridge checks the sender itself; the app's word is not enough.
				const { verdict, outgoing } = await mail.verdictOf(mailId);
				if (verdict !== 'pass' && !outgoing && body.confirmedByUser !== true) {
					log(`refused /extract for a mail whose sender did not pass (${verdict})`);
					return send(res, 403, {
						error: 'The sender of this mail is not verified (DKIM/SPF). Confirm it first.',
						code: 'SENDER_UNVERIFIED',
						verdict
					});
				}
			}
			if (!llm) throw notSetUp('LLM');
			const result = await llm.extract({ text: body.text, hints });
			log(
				`extracted with ${result.model} (${result.attempts.length} attempt(s), ${result.ms} ms, ${result.redactions.total} redaction(s))`
			);
			return send(res, 200, result);
		}

		if (await handlePortalRequest({ req, res, url, path, portals, send, sendBytes, readJson })) {
			return;
		}

		return send(res, 404, { error: 'not found' });
	}

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://${LOOPBACK}`);
		if (!hostAllowed(req)) return send(res, 421, { error: 'wrong host' });

		const origin = req.headers.origin;
		if (origin !== undefined) {
			if (!allowedOrigins.has(origin)) {
				log(`refused origin ${JSON.stringify(origin).slice(0, 80)}`);
				return send(res, 403, { error: 'origin not allowed' });
			}
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
		}

		if (req.method === 'OPTIONS') {
			if (origin === undefined) return send(res, 400, { error: 'preflight without origin' });
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
			res.setHeader('Access-Control-Max-Age', '600');
			// Chrome's Private/Local Network Access asks this of loopback targets.
			if (req.headers['access-control-request-private-network'] === 'true') {
				res.setHeader('Access-Control-Allow-Private-Network', 'true');
			}
			res.writeHead(204);
			return res.end();
		}

		try {
			await route(req, res, url);
		} catch (/** @type {any} */ error) {
			const status =
				error.status ??
				(error instanceof PinMismatchError
					? 502
					: error instanceof HibiscusUnreachableError
						? 502
						: error.code?.startsWith?.('KEYCHAIN')
							? 503
							: error.code?.startsWith?.('HIBISCUS')
								? 502
								: 500);
			// Messages are the bridge's own; they carry no password, no bank data and no mail text.
			log(`${req.method} ${url.pathname}: ${error.code ?? error.name}: ${error.message}`);
			if (!res.headersSent) {
				send(res, status, {
					error: error.message,
					code: error.code ?? null,
					...(Array.isArray(error.attempts) ? { attempts: error.attempts } : {}),
					...(error.step ? { step: error.step } : {}),
					...(error.reason ? { reason: error.reason } : {})
				});
			}
		}
	});

	return {
		server,
		/**
		 * @param {{ host?: string, port?: number }} [options]
		 * @returns {Promise<{ host: string, port: number }>}
		 */
		async listen({ host = LOOPBACK, port = config.bridge.port } = {}) {
			if (host !== LOOPBACK) {
				throw new Error(`The bridge listens on ${LOOPBACK} only, not on ${host}.`);
			}
			await new Promise((resolve, reject) => {
				server.once('error', reject);
				server.listen({ host, port, exclusive: true }, () => resolve(undefined));
			});
			const address = /** @type {import('node:net').AddressInfo} */ (server.address());
			if (address.address !== LOOPBACK) {
				server.close();
				throw new Error(`Bound to ${address.address} instead of ${LOOPBACK}; refusing to serve.`);
			}
			boundPort = address.port;
			return { host: address.address, port: address.port };
		},
		close() {
			return new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			});
		}
	};
}
