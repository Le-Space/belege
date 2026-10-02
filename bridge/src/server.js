// The bridge's HTTP API, on 127.0.0.1 only.
//
//   GET  /health                         no token
//   POST /pair         { code }          no token → { token }
//   GET  /hibiscus/accounts              token
//   GET  /hibiscus/transactions?account=<id>&since=YYYY-MM-DD   token
//   GET  /mail/messages?since=YYYY-MM-DD[&until=YYYY-MM-DD]&scope=accounting   token
//   GET  /mail/attachment?id=<mail id>&part=<n>                   token → the bytes
//   POST /mail/trash   { id }                                     token → the one mail moved to the Trash (a person's click)
//   GET  /mail/search?text=&amount=&from=a.example,b.example&term=…&around=YYYY-MM-DD&days=   token
//   POST /mail/assist  { counterparty, purpose, amount, around, days, knownDomains }   token → LLM terms, hits, pick
//   Every LLM route also takes `redactTerms`: up to 20 more terms to black out for
//   that call (the app sends the company's names from Einstellungen; llm/redact.js).
//   POST /match/assist { booking, candidates }                  token → the LLM's pick among receipts
//   GET  /share/<id>                                               the snapshot of a read share (no token: the id is the capability; no Origin)
//   POST /share { scope, redacted, minutes, data }                 token → { id, expiresAt } (issue #124)
//   GET  /share                                                    token → the active shares, without their data
//   DELETE /share/<id>                                             token → revoked
//   POST /vendor/assist { vendor, from, until, opening, closing, rows, findings }  token → a few notes on what does not add up
//   POST /transfer/assist { booking, candidates }               token → the LLM's pick of an own transfer's other side
//   GET  /llm/status                                              token → provider, models, key present?
//   POST /extract      { text, hints, source, confirmedByUser }   token
//   GET  /rates?asset=BTC&date=YYYY-MM-DD[&prefer=kraken][&contract=0x…&chain=ethereum[&block=N&decimals=D]]  token → EUR per unit, source (rates.js; the DEX pool at the block: dex-rate.js)
//   GET  /enablebanking/banks?country=DE                          token → the banks Enable Banking offers (enablebanking-links.js)
//   POST /enablebanking/link { bank, country, psuType? }         token → { url, state, validUntil }: the bank's page
//   POST /enablebanking/finish { code, state }                   token → { link }: the bank's answer becomes a session
//   GET  /enablebanking/links                                     token → { links }: linked banks, consent end, IBAN last four
//   DELETE /enablebanking/links/<session id>                      token → closed at Enable Banking and forgotten
//   GET  /enablebanking/accounts                                  token → linked accounts, which may leave, the allowed ones' IBAN key
//   GET  /enablebanking/transactions?account=<uid>&since=YYYY-MM-DD token → an allowed account's booked transactions
//   GET  /kraken/balances                                         token → non-zero balances (kraken.js)
//   GET  /kraken/ledgers?since=YYYY-MM-DD                         token → the ledger, oldest first
//   GET  /chains                                                  token → chains, endpoints, explorers, alchemy: bool (chains/)
//   GET  /bitcoin/key                                             token → the zpub's fingerprint, never the zpub
//   GET  /lan-relay                                               token → the relay for own devices in the own network: its address (lan-relay.js)
//   POST /<chain>/wallet { address, endpoints? }                  token → an own wallet's transfers and balance
//   POST /aleph/accounts { addresses, api? }                      token → which are Aleph accounts: credits, entries (aleph.js)
//   GET  /aleph/statement?address=0x…&month=YYYY-MM[&api=]        token → a month's credits: balances, top-ups, usage per day
//   GET  /backup/status                                           token → { aleph: { configured, address, credits, ingestUrl } } (aleph-backup.js)
//   POST /backup/aleph/pin { cid }                                token → { cid, address, itemHash, status }: what the app uploaded, kept
//   POST /backup/aleph?name=<file name>  (the sealed bytes)       token → { cid, size, address, itemHash, status }: uploaded and kept
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

import { MAX_SHARE_BYTES, createShares } from './shares.js';
import http from 'node:http';

import { HibiscusUnreachableError, PinMismatchError } from './hibiscus.js';
import { ibanAllowed, normalizeAccount, normalizeTransaction } from './normalize.js';
import { decodeMailId, isIsoDay, isPartNumber } from './mail/mime.js';
import { handlePortalRequest } from './portals/routes.js';
import { ALEPH_API } from './aleph.js';
import { MAX_BACKUP_BYTES } from './aleph-backup.js';
import { checkEndpoint } from './chains/http.js';
import { withExtraTerms } from './llm/redact.js';

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
 * @param {ReturnType<typeof import('./llm/match-assist.js').createMatchAssist> | null} [options.matchAssist]
 * @param {ReturnType<typeof import('./llm/transfer-assist.js').createTransferAssist> | null} [options.transferAssist]
 * @param {ReturnType<typeof import('./llm/vendor-assist.js').createVendorAssist> | null} [options.vendorAssist]
 * @param {ReturnType<typeof createShares>} [options.shares] read shares for an assistant, in memory
 *   "✦ KI-Vorschlag" under "Beleg zuordnen": null without an LLM
 * @param {import('./portals/manager.js').PortalManager | null} [options.portals] the portal connector
 * @param {ReturnType<typeof import('./rates.js').createRateService> | null} [options.rates] exchange rates
 * @param {ReturnType<typeof import('./kraken.js').createKrakenClient> | null} [options.kraken] null when Kraken is not set up
 * @param {ReturnType<typeof import('./enablebanking.js').createEnableBankingClient> | null} [options.enablebanking]
 *   the own Enable Banking application: null when not set up (issue #224)
 * @param {ReturnType<typeof import('./enablebanking-links.js').createEnableBankingLinks> | null} [options.enablebankingLinks]
 *   linking a bank through it: null when not set up
 * @param {ReturnType<typeof import('./chains/index.js').createWalletService> | null} [options.wallets] own wallets on public chains
 * @param {ReturnType<typeof import('./aleph.js').createAlephClient> | null} [options.aleph] Aleph Cloud credits, read only
 * @param {boolean} [options.alephLoopback] tests: an Aleph API on 127.0.0.1
 * @param {string} [options.alephApi] the Aleph API asked when the request names none
 * @param {ReturnType<typeof import('./aleph-backup.js').createAlephBackup> | null} [options.alephBackup]
 *   the backup's copy on Aleph, with the bridge's own key (issue #77)
 * @param {{ addr: string | null, stats: () => { reservations: number, connections: number } } | null} [options.lanRelay]
 *   the relay for own devices (lan-relay.js): null when not set up, `addr` null when it did not start
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
	matchAssist = null,
	transferAssist = null,
	vendorAssist = null,
	shares = createShares(),
	portals = null,
	rates = null,
	kraken = null,
	enablebanking = null,
	enablebankingLinks = null,
	wallets = null,
	aleph = null,
	alephLoopback = false,
	alephApi = ALEPH_API,
	alephBackup = null,
	lanRelay = null,
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

	/** A body as bytes, up to `limit`. @param {http.IncomingMessage} req @param {number} limit */
	function readBytes(req, limit) {
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
			req.on('end', () => resolve(Buffer.concat(chunks)));
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
				portals: { available: Boolean(portals) },
				kraken: { configured: Boolean(kraken) },
				enablebanking: { configured: Boolean(enablebanking) },
				backup: { aleph: Boolean(alephBackup) },
				wallets: { available: Boolean(wallets) },
				lanRelay: { configured: Boolean(lanRelay), running: Boolean(lanRelay?.addr) }
			});
		}

		if (path === '/pair' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req));
			const token = await pairing.pair(body?.code);
			log('paired a new client');
			return send(res, 200, { token });
		}

		// A read share (issue #124): the id is the capability, so no token; but
		// never for a web page – a request with an Origin is refused, and no
		// CORS header is ever sent for it.
		const shareId = /^\/share\/([A-Za-z0-9_-]{22})$/.exec(path)?.[1];
		if (shareId && req.method === 'GET' && !req.headers.authorization) {
			if (req.headers.origin !== undefined) {
				return send(res, 403, { error: 'a share is not for a web page' });
			}
			const body = shares.read(shareId);
			if (body === null) return send(res, 404, { error: 'no such share, or it expired' });
			log('a share was read');
			res.writeHead(200, {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Length': Buffer.byteLength(body),
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			});
			return res.end(body);
		}

		if (!pairing.verify(bearer(req))) {
			return send(res, 401, { error: 'unauthorized' });
		}

		if (path === '/share' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req, MAX_SHARE_BYTES + 4096));
			const minutes = Number(body?.minutes);
			if (
				typeof body?.scope !== 'string' ||
				typeof body?.redacted !== 'boolean' ||
				!Number.isFinite(minutes) ||
				body?.data === undefined
			) {
				return send(res, 400, { error: 'scope, redacted, minutes and data are required' });
			}
			const share = shares.create({
				scope: body.scope,
				redacted: body.redacted,
				minutes,
				data: body.data
			});
			log(
				`a share was created (${share.redacted ? 'redacted' : 'not redacted'}, until ${share.expiresAt})`
			);
			return send(res, 200, share);
		}
		if (path === '/share' && req.method === 'GET') {
			return send(res, 200, { shares: shares.list() });
		}
		if (shareId && req.method === 'DELETE') {
			const ok = shares.revoke(shareId);
			log(ok ? 'a share was revoked' : 'revoke: no such share');
			return send(res, ok ? 200 : 404, { ok });
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

		if (path === '/mail/trash' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req, 2000));
			if (!decodeMailId(body?.id)) return send(res, 400, { error: 'id must be a mail id' });
			if (!mail) throw notSetUp('Mail');
			const { trash } = await mail.trash(body.id);
			log('moved 1 mail to the Trash');
			return send(res, 200, { trashed: true, trash });
		}

		if (path === '/mail/search' && req.method === 'GET') {
			const text = (url.searchParams.get('text') ?? '').trim() || null;
			const amount = (url.searchParams.get('amount') ?? '').trim() || null;
			const from = domainList(url.searchParams.get('from'));
			if (from === null) return send(res, 400, { error: 'from must be up to 3 mail domains' });
			// A crypto payment's hash, address or quantity: plain tokens only.
			const terms = url.searchParams.getAll('term').map((t) => t.trim());
			if (terms.length > 6 || terms.some((t) => !/^[\w.,:-]{3,100}$/.test(t))) {
				return send(res, 400, { error: 'term: up to 6, each 3–100 of letters, digits and .,:_-' });
			}
			const around = url.searchParams.get('around') || null;
			const daysParam = url.searchParams.get('days');
			const days = daysParam === null || daysParam === '' ? 14 : Number(daysParam);
			if (!text && !amount && !from.length && !terms.length)
				return send(res, 400, { error: 'text, amount, from or term is required' });
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
			const messages = await mail.search({ text, amount, from, terms, around, days });
			log(`search found ${messages.length} mail(s)`);
			return send(res, 200, { messages });
		}

		if (path === '/match/assist' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req, MAX_EXTRACT_BODY));
			const b = body?.booking;
			const list = body?.candidates;
			/** @param {unknown} v @param {number} max */
			const str = (v, max) => typeof v === 'string' && v.length <= max;
			const okBooking =
				b &&
				typeof b === 'object' &&
				['counterparty', 'purpose', 'amount', 'day'].every(
					(k) => b[k] === undefined || str(b[k], k === 'purpose' ? 1000 : 200)
				);
			const okList =
				Array.isArray(list) &&
				list.length >= 1 &&
				list.length <= 25 &&
				list.every(
					(c) =>
						c &&
						str(c.id, 64) &&
						['vendor', 'amount', 'currency', 'date', 'number', 'summary'].every(
							(k) => c[k] === undefined || c[k] === null || str(c[k], 200)
						)
				);
			if (!okBooking || !okList) {
				return send(res, 400, { error: 'booking and 1–25 candidates are required' });
			}
			if (!llm || !matchAssist) throw notSetUp('LLM');
			const result = await withExtraTerms(body?.redactTerms, () =>
				matchAssist.pick({ booking: b, candidates: list })
			);
			log(
				`receipt pick: ${list.length} candidate(s), ${result.pick ? `pick ${result.pick.confidence}` : 'no pick'}`
			);
			return send(res, 200, result);
		}

		if (path === '/vendor/assist' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req, MAX_EXTRACT_BODY));
			/** @param {unknown} v @param {number} max */
			const str = (v, max) => typeof v === 'string' && v.length <= max;
			const ok =
				body &&
				str(body.vendor, 200) &&
				str(body.from, 10) &&
				str(body.until, 10) &&
				(body.opening === null || str(body.opening, 20)) &&
				str(body.closing, 20) &&
				Array.isArray(body.rows) &&
				body.rows.length >= 1 &&
				body.rows.length <= 120 &&
				body.rows.every(
					(/** @type {any} */ r) =>
						r &&
						str(r.date, 10) &&
						(r.kind === 'payment' || r.kind === 'receipt') &&
						str(r.balance, 20)
				) &&
				Array.isArray(body.findings) &&
				body.findings.every((/** @type {unknown} */ f) => str(f, 300));
			if (!ok) return send(res, 400, { error: 'a vendor timeline with 1–120 rows is required' });
			if (!llm || !vendorAssist) throw notSetUp('LLM');
			const result = await withExtraTerms(body?.redactTerms, () => vendorAssist.explain(body));
			log(`vendor notes: ${body.rows.length} row(s), ${result.notes.length} note(s)`);
			return send(res, 200, result);
		}

		if (path === '/transfer/assist' && req.method === 'POST') {
			const body = /** @type {any} */ (await readJson(req, MAX_EXTRACT_BODY));
			const b = body?.booking;
			const list = body?.candidates;
			/** @param {unknown} v @param {number} max */
			const str = (v, max) => typeof v === 'string' && v.length <= max;
			/** @param {any} x */
			const okFields = (x) =>
				x &&
				typeof x === 'object' &&
				(x.direction === undefined || x.direction === 'in' || x.direction === 'out') &&
				['amount', 'quantity', 'asset', 'day', 'account', 'counterparty', 'purpose'].every(
					(k) => x[k] === undefined || x[k] === null || str(x[k], k === 'purpose' ? 500 : 200)
				);
			const okList =
				Array.isArray(list) &&
				list.length >= 1 &&
				list.length <= 8 &&
				list.every((c) => okFields(c) && str(c.id, 64));
			if (!okFields(b) || !okList) {
				return send(res, 400, { error: 'booking and 1–8 candidates are required' });
			}
			if (!llm || !transferAssist) throw notSetUp('LLM');
			const result = await withExtraTerms(body?.redactTerms, () =>
				transferAssist.pick({ booking: b, candidates: list })
			);
			log(
				`transfer pick: ${list.length} candidate(s), ${result.pick ? `pick ${result.pick.confidence}` : 'no pick'}`
			);
			return send(res, 200, result);
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
			const result = await withExtraTerms(body?.redactTerms, () =>
				assist.search({
					counterparty,
					purpose,
					amount,
					around,
					days,
					knownDomains
				})
			);
			log(
				`assisted search: ${result.terms.length} term(s), ${result.domains.length} domain(s), ${result.messages.length} mail(s), ${result.pick ? `pick ${result.pick.confidence}` : 'no pick'}`
			);
			return send(res, 200, result);
		}

		if (path.startsWith('/aleph/')) {
			if (!aleph) return send(res, 503, { error: 'Aleph is not available' });
			/** The API asked: Aleph's, or one of the person's (https), checked. @param {unknown} given */
			const apiOf = (given) => {
				if (given === undefined || given === null || given === '') return alephApi;
				return checkEndpoint(given, { allowLoopback: alephLoopback });
			};
			if (path === '/aleph/accounts' && req.method === 'POST') {
				const body = await readJson(req);
				const api = apiOf(body?.api);
				const addresses = Array.isArray(body?.addresses) ? body.addresses.map(String) : null;
				if (!api) return send(res, 400, { error: 'api must be an https:// URL' });
				if (!addresses) return send(res, 400, { error: 'addresses is required' });
				const accounts = await aleph.accounts({ addresses, api });
				log(
					`aleph: ${addresses.length} address(es) asked, ${accounts.filter((a) => a.credits > 0 || a.entries > 0).length} account(s)`
				);
				return send(res, 200, { accounts });
			}
			if (path === '/aleph/statement' && req.method === 'GET') {
				const api = apiOf(url.searchParams.get('api'));
				if (!api) return send(res, 400, { error: 'api must be an https:// URL' });
				const statement = await aleph.statement({
					address: url.searchParams.get('address') ?? '',
					month: url.searchParams.get('month') ?? '',
					api
				});
				log(
					`aleph: statement, ${statement.entries} entr(ies), ${statement.usage.length} line(s), ${statement.difference === 0 ? 'balanced' : 'difference'}`
				);
				return send(res, 200, statement);
			}
			return send(res, 404, { error: 'not found' });
		}

		if (path === '/backup/status' && req.method === 'GET') {
			if (!alephBackup) return send(res, 200, { aleph: { configured: false } });
			const address = await alephBackup.address();
			// What the account can still pay with; unknown when Aleph does not answer.
			const credits = aleph
				? await aleph
						.accounts({ addresses: [address], api: alephApi })
						.then((list) => list[0]?.credits ?? 0)
						.catch(() => null)
				: null;
			return send(res, 200, {
				aleph: { configured: true, address, credits, ingestUrl: alephBackup.ingestUrl }
			});
		}

		if (path.startsWith('/backup/aleph') && req.method === 'POST' && !alephBackup) {
			return send(res, 503, {
				error: 'the Aleph backup is not set up: run `pnpm setup:aleph`',
				code: 'ALEPH_BACKUP_NOT_SET_UP'
			});
		}

		if (path === '/backup/aleph/pin' && req.method === 'POST' && alephBackup) {
			// The app uploaded the sealed backup to Aleph's IPFS host itself; the
			// bridge only signs the STORE message that has Aleph keep it.
			const body = /** @type {any} */ (await readJson(req));
			let kept;
			try {
				kept = await alephBackup.pin(String(body?.cid ?? ''));
			} catch (/** @type {any} */ error) {
				if (error?.name === 'BackendError') {
					throw Object.assign(new Error(error.message), {
						status: 502,
						code: `ALEPH_BACKUP_${error.code ?? 'FAILED'}`
					});
				}
				throw error;
			}
			log(`backup: kept on Aleph, ${kept.status}`);
			return send(res, 200, kept);
		}

		if (path === '/backup/aleph' && req.method === 'POST' && alephBackup) {
			const name = url.searchParams.get('name') ?? 'belege-backup';
			if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
				return send(res, 400, { error: 'name: letters, digits, dot, dash and underscore only' });
			}
			const bytes = await readBytes(req, MAX_BACKUP_BYTES);
			if (bytes.length === 0) return send(res, 400, { error: 'the backup is empty' });
			let kept;
			try {
				kept = await alephBackup.put(new Uint8Array(bytes), { name });
			} catch (/** @type {any} */ error) {
				// The storage bridge's BackendError: Aleph refused or did not answer.
				if (error?.name === 'BackendError') {
					throw Object.assign(new Error(error.message), {
						status: 502,
						code: `ALEPH_BACKUP_${error.code ?? 'FAILED'}`
					});
				}
				throw error;
			}
			log(`backup: ${bytes.length} byte(s) to Aleph, ${kept.status}`);
			return send(res, 200, kept);
		}

		if (path === '/rates' && req.method === 'GET') {
			if (!rates) return send(res, 503, { error: 'exchange rates are not available' });
			const asset = url.searchParams.get('asset') ?? '';
			const date = url.searchParams.get('date') ?? '';
			if (!/^[A-Z0-9]{2,10}$/.test(asset)) return send(res, 400, { error: 'asset is required' });
			const prefer = url.searchParams.get('prefer');
			if (prefer !== null && prefer !== 'kraken') {
				return send(res, 400, { error: 'prefer must be kraken' });
			}
			// A token not in the list: by its contract on its chain (issue #115).
			const contract = url.searchParams.get('contract')?.toLowerCase() ?? null;
			const chain = url.searchParams.get('chain');
			if (contract !== null && !/^0x[0-9a-f]{40}$/.test(contract)) {
				return send(res, 400, { error: 'contract must be 0x + 40 hex' });
			}
			// With the booking's block and the token's decimals: its DEX pool, when CoinGecko has no rate (#163).
			const blockText = url.searchParams.get('block');
			const decimalsText = url.searchParams.get('decimals');
			if (blockText !== null && !/^[1-9]\d{0,11}$/.test(blockText)) {
				return send(res, 400, { error: 'block must be a positive integer' });
			}
			if (decimalsText !== null && !/^\d{1,2}$/.test(decimalsText)) {
				return send(res, 400, { error: 'decimals must be 0 to 99' });
			}
			return send(
				res,
				200,
				await rates.rate(asset, date, {
					prefer,
					contract,
					chain,
					block: blockText === null ? null : Number(blockText),
					decimals: decimalsText === null ? null : Number(decimalsText)
				})
			);
		}

		if (path.startsWith('/kraken/') && req.method === 'GET') {
			if (!kraken) {
				return send(res, 503, { error: 'Kraken is not set up: run `pnpm setup:kraken`.' });
			}
			if (path === '/kraken/balances') {
				const balances = await kraken.balances();
				log(`kraken: ${balances.length} balance(s)`);
				return send(res, 200, { balances });
			}
			if (path === '/kraken/ledgers') {
				const since = url.searchParams.get('since') ?? '';
				if (!isIsoDay(since)) return send(res, 400, { error: 'since must be YYYY-MM-DD' });
				const { entries, transferRefs, transferRefsReason } = await kraken.ledgers(since);
				log(`kraken: ${entries.length} ledger entries since ${since}`);
				if (transferRefs === 'refused') {
					log(
						`kraken: deposits and withdrawals get no on-chain hash (${transferRefsReason}); does the key have Funds → Query?`
					);
				}
				return send(res, 200, { since, entries, transferRefs });
			}
		}

		if (path.startsWith('/enablebanking/')) {
			if (!enablebankingLinks) {
				return send(res, 503, {
					error: 'Enable Banking is not set up: run `pnpm setup:enablebanking`.',
					code: 'EB_NOT_SET_UP'
				});
			}
			if (path === '/enablebanking/banks' && req.method === 'GET') {
				return send(res, 200, {
					banks: await enablebankingLinks.banks(url.searchParams.get('country') ?? '')
				});
			}
			if (path === '/enablebanking/link' && req.method === 'POST') {
				const body = /** @type {any} */ (await readJson(req));
				return send(res, 200, await enablebankingLinks.start(body ?? {}));
			}
			if (path === '/enablebanking/finish' && req.method === 'POST') {
				const body = /** @type {any} */ (await readJson(req));
				return send(res, 200, { link: await enablebankingLinks.finish(body ?? {}) });
			}
			if (path === '/enablebanking/accounts' && req.method === 'GET') {
				return send(res, 200, { accounts: await enablebankingLinks.accounts() });
			}
			if (path === '/enablebanking/transactions' && req.method === 'GET') {
				return send(
					res,
					200,
					await enablebankingLinks.transactions(
						url.searchParams.get('account') ?? '',
						url.searchParams.get('since') ?? ''
					)
				);
			}
			if (path === '/enablebanking/links' && req.method === 'GET') {
				return send(res, 200, { links: await enablebankingLinks.list() });
			}
			const linkId = /^\/enablebanking\/links\/([0-9a-fA-F-]{36})$/.exec(path)?.[1];
			if (linkId && req.method === 'DELETE') {
				await enablebankingLinks.unlink(linkId);
				return send(res, 200, { ok: true });
			}
		}

		// Own wallets: GET /chains, POST /<chain>/wallet (chains/index.js).
		if (path === '/chains' && req.method === 'GET') {
			if (!wallets) return send(res, 503, { error: 'wallets are not available' });
			// Whether an Alchemy key is set up (EVM wallets are then read there); never the key.
			return send(res, 200, { chains: wallets.chains(), alchemy: await wallets.alchemy() });
		}
		if (path === '/lan-relay' && req.method === 'GET') {
			// The address the books keep, so own devices find it; counts, never who.
			return send(res, 200, {
				configured: Boolean(lanRelay),
				running: Boolean(lanRelay?.addr),
				addr: lanRelay?.addr ?? null,
				...(lanRelay?.addr ? lanRelay.stats() : {})
			});
		}
		if (path === '/bitcoin/key' && req.method === 'GET') {
			if (!wallets) return send(res, 503, { error: 'wallets are not available' });
			const fingerprint = await wallets.bitcoinKey();
			return send(res, 200, { configured: Boolean(fingerprint), fingerprint });
		}
		const walletPath = /^\/([a-z0-9-]{2,30})\/wallet$/.exec(path);
		if (walletPath && req.method === 'POST' && wallets?.has(walletPath[1])) {
			// A POST, so the address is in no URL and no access log.
			const body = /** @type {any} */ (await readJson(req));
			const result = await wallets.sync({ ...body, chain: walletPath[1] });
			log(
				`${result.chain}: ${result.transactions} transaction(s), ${result.entries.length} entries, ${result.balances.length} balance(s), ${result.unknownAssets} unknown asset(s)${result.unknownStatus ? `, ${result.unknownStatus} without a receipt status (value not booked)` : ''}`
			);
			return send(res, 200, result);
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
			const result = await withExtraTerms(body?.redactTerms, () =>
				llm.extract({ text: body.text, hints })
			);
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
