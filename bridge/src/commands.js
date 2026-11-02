// The bridge's commands: every function the bridge offers, apart from the
// transport that carries it (Le-Space/belege#574, milestone M1 of #567).
//
// A command names what it does (`bank.accounts`, `mail.search`, `llm.extract`),
// the HTTP method and path the app calls it by today, the scope a paired
// device will need for it once the bridge speaks UCEP (#579), what body it
// takes, and `run`: parsed input in, an answer out – JSON, bytes, or a
// JSON text already serialised. `run` never sees a request or a response
// object, so the same command serves HTTP (server.js) and the libp2p stream
// of the bridge's node (stream.js, `request { method, path, body? }`). Checks
// on who may call (host, origin, token; the device proof) stay with the
// transport; checks on what is asked (shapes, limits, allowed accounts) stay
// here, with the command.
//
// Scopes are names only for now (HTTP's token is all of them, and so is a
// device the node's gate let through); scopes per command follow in M2
// (#579). A stranger over libp2p is refused before any of this runs
// (@belege/device-gate).

import { MAX_SHARE_BYTES } from './shares.js';
import { HibiscusUnreachableError, PinMismatchError } from './hibiscus.js';
import { ibanAllowed, normalizeAccount, normalizeTransaction } from './normalize.js';
import { decodeMailId, isIsoDay, isPartNumber } from './mail/mime.js';
import { ALEPH_API } from './aleph.js';
import { MAX_BACKUP_BYTES } from './aleph-backup.js';
import { checkEndpoint } from './chains/http.js';
import { withExtraTerms } from './llm/redact.js';
import { redactionOff, redactionOffForEnclave } from './config.js';

export const VERSION = '0.2.0';
/** A JSON body, unless a command says more. */
export const MAX_BODY = 4096;
/** /extract carries a receipt's text: 30 000 characters are sent on, some room for hints. */
export const MAX_EXTRACT_BODY = 256 * 1024;

const DOMAIN = /^(?=.{4,100}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * `a.example,b.example` → the domains; [] for none; null when one is no domain
 * or there are more than three.
 *
 * @param {string | null} raw
 */
export function domainList(raw) {
	if (!raw) return [];
	const list = raw
		.split(',')
		.map((d) => d.trim().toLowerCase())
		.filter(Boolean);
	return list.length <= 3 && list.every((d) => DOMAIN.test(d)) ? list : null;
}

/**
 * What a command answers.
 *
 * @typedef {{ status: number, json: unknown }
 *   | { status: number, bytes: Uint8Array, mime: string }
 *   | { status: number, text: string, contentType: string }} Answer
 */

/**
 * What a command gets: the query, the path's parameters, the body as the
 * command asked for it, and the caller's token where the command needs it
 * (`session.unpair`).
 *
 * @typedef {object} Input
 * @property {URLSearchParams} query
 * @property {Record<string, string>} params
 * @property {any} body parsed JSON, bytes (`body: 'bytes'`), or {} without one
 * @property {string | null} token the bearer token the caller used, or null
 */

/**
 * @typedef {object} Command
 * @property {string} name `area.verb`, what a device will call it by
 * @property {'GET' | 'POST' | 'DELETE'} method
 * @property {string | ((path: string) => Record<string, string> | null)} path a fixed path, or a matcher
 * @property {string} scope the grant a device will need (#579); '' for public
 * @property {boolean} [public] no token: `/health`, `/pair`, a share by its id
 * @property {boolean} [noOrigin] refused with an Origin header: a share is never for a web page
 * @property {boolean} [unauthenticatedOnly] only matches a request without a token (a share's read)
 * @property {'json' | 'bytes' | 'none'} [body] what to read before `run` (GET: none)
 * @property {number} [bodyLimit] bytes; the default is MAX_BODY for JSON
 * @property {(input: Input) => Promise<Answer> | Answer} run
 */

/** @param {number} status @param {unknown} json @returns {Answer} */
export const json = (status, json) => ({ status, json });
/** @param {Uint8Array} bytes @param {string} mime @returns {Answer} */
export const bytes = (bytes, mime) => ({ status: 200, bytes, mime });

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

/** @param {unknown} v @param {number} max */
const str = (v, max) => typeof v === 'string' && v.length <= max;

/**
 * The status an error answers with, when it names none.
 *
 * @param {any} error
 */
export function statusOf(error) {
	return (
		error.status ??
		(error instanceof PinMismatchError
			? 502
			: error instanceof HibiscusUnreachableError
				? 502
				: error.code?.startsWith?.('KEYCHAIN')
					? 503
					: error.code?.startsWith?.('HIBISCUS')
						? 502
						: 500)
	);
}

/**
 * What an error answers with, over HTTP and over the stream alike: the
 * bridge's own message and code, a model's attempts as model, status and
 * time (#417) – never bank data, mail or receipt text. `line` is for the log.
 *
 * @param {any} error
 * @returns {{ json: Record<string, unknown>, line: string }}
 */
export function errorJson(error) {
	const attempts = Array.isArray(error.attempts) ? error.attempts : null;
	const tried = attempts
		? ` (${attempts.map((/** @type {any} */ a) => `${a.model}: ${a.reason}, ${a.ms} ms`).join('; ')})`
		: '';
	return {
		json: {
			error: error.message,
			code: error.code ?? null,
			...(attempts ? { attempts } : {}),
			...(error.step ? { step: error.step } : {}),
			...(error.provider ? { provider: error.provider } : {}),
			...(error.reason ? { reason: error.reason } : {})
		},
		line: `${error.code ?? error.name}: ${error.message}${tried}`
	};
}

/**
 * The commands, bound to what the bridge has.
 *
 * @param {object} deps everything `createBridgeServer` takes, see server.js
 * @param {import('./config.js').BridgeConfig} deps.config
 * @param {ReturnType<typeof import('./pairing.js').createPairing>} deps.pairing
 * @param {(() => import('./hibiscus.js').HibiscusClient) | null} deps.hibiscus
 * @param {import('./mail/imap.js').MailClient | null} deps.mail
 * @param {import('./llm/extract.js').Extractor | null} deps.llm
 * @param {() => Promise<boolean>} deps.llmKeyPresent
 * @param {(() => object) | null} deps.llmTee
 * @param {any} deps.assist
 * @param {any} deps.matchAssist
 * @param {any} deps.transferAssist
 * @param {any} deps.vendorAssist
 * @param {ReturnType<typeof import('./shares.js').createShares>} deps.shares
 * @param {any} deps.rates
 * @param {any} deps.kraken
 * @param {any} deps.paperless
 * @param {any} deps.enablebanking
 * @param {any} deps.enablebankingLinks
 * @param {any} deps.wallets
 * @param {any} deps.aleph
 * @param {boolean} deps.alephLoopback
 * @param {string} deps.alephApi
 * @param {any} deps.alephBackup
 * @param {{ addr: string | null, stats: () => object } | null} deps.lanRelay
 * @param {any} [deps.portals] the portal connector, for /health only (its routes stay in portals/routes.js)
 * @param {{ status: () => object, disarm: () => Promise<void> } | null} [deps.node] the bridge's libp2p node (node.js, #573)
 * @param {(message: string) => void} deps.log
 * @returns {Command[]}
 */
export function createCommands({
	config,
	pairing,
	hibiscus,
	mail,
	llm,
	llmKeyPresent,
	llmTee,
	assist,
	matchAssist,
	transferAssist,
	vendorAssist,
	shares,
	rates,
	kraken,
	paperless,
	enablebanking,
	enablebankingLinks,
	wallets,
	aleph,
	alephLoopback,
	alephApi = ALEPH_API,
	alephBackup,
	lanRelay,
	portals = null,
	node = null,
	log
}) {
	const suffixes = config.hibiscus.ibanSuffixes;

	/** Allowed accounts only; the rest never leaves this function. */
	async function allowedAccounts() {
		if (!hibiscus)
			throw Object.assign(new Error('Hibiscus is not set up: run setup:hibiscus.'), {
				status: 503
			});
		const all = await hibiscus().accounts();
		return all.filter((k) => ibanAllowed(k.iban, suffixes));
	}

	/** The API asked: Aleph's, or one of the person's (https), checked. @param {unknown} given */
	const apiOf = (given) => {
		if (given === undefined || given === null || given === '') return alephApi;
		return checkEndpoint(given, { allowLoopback: alephLoopback });
	};

	/** The storage bridge's BackendError: Aleph refused or did not answer. @param {any} error */
	const alephBackupError = (error) => {
		if (error?.name === 'BackendError') {
			return Object.assign(new Error(error.message), {
				status: 502,
				code: `ALEPH_BACKUP_${error.code ?? 'FAILED'}`
			});
		}
		return error;
	};

	const notSetUpAnswer = {
		alephBackup: json(503, {
			error: 'the Aleph backup is not set up: run `pnpm setup:aleph`',
			code: 'ALEPH_BACKUP_NOT_SET_UP'
		}),
		kraken: json(503, { error: 'Kraken is not set up: run `pnpm setup:kraken`.' }),
		paperless: json(503, {
			error: 'Paperless is not set up: run `pnpm setup:paperless`.',
			code: 'PAPERLESS_NOT_SET_UP'
		}),
		enablebanking: json(503, {
			error: 'Enable Banking is not set up: run `pnpm setup:enablebanking`.',
			code: 'EB_NOT_SET_UP'
		}),
		wallets: json(503, { error: 'wallets are not available' }),
		aleph: json(503, { error: 'Aleph is not available' }),
		rates: json(503, { error: 'exchange rates are not available' })
	};

	/** A share's id in a path. @param {string} path */
	const shareIdOf = (path) => {
		const id = /^\/share\/([A-Za-z0-9_-]{22})$/.exec(path)?.[1];
		return id ? { id } : null;
	};
	/** An Enable Banking link's id in a path. @param {string} path */
	const linkIdOf = (path) => {
		const id = /^\/enablebanking\/links\/([0-9a-fA-F-]{36})$/.exec(path)?.[1];
		return id ? { id } : null;
	};
	/** `/<chain>/wallet` for a chain the wallet service has. @param {string} path */
	const walletChainOf = (path) => {
		const chain = /^\/([a-z0-9-]{2,30})\/wallet$/.exec(path)?.[1];
		return chain && wallets?.has(chain) ? { chain } : null;
	};

	/** @type {Command[]} */
	const commands = [
		{
			name: 'bridge.health',
			method: 'GET',
			path: '/health',
			scope: '',
			public: true,
			run: () =>
				json(200, {
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
					paperless: { configured: Boolean(paperless) },
					enablebanking: { configured: Boolean(enablebanking) },
					backup: { aleph: Boolean(alephBackup) },
					wallets: { available: Boolean(wallets) },
					lanRelay: { configured: Boolean(lanRelay), running: Boolean(lanRelay?.addr) },
					// The bridge's own node (#573): its peer id, whether the gate is up, where it listens.
					node: node ? node.status() : { enabled: false }
				})
		},
		{
			name: 'session.pair',
			method: 'POST',
			path: '/pair',
			scope: '',
			public: true,
			body: 'json',
			run: async ({ body }) => {
				const token = await pairing.pair(body?.code);
				log('paired a new client');
				return json(200, { token });
			}
		},
		{
			// A read share (issue #124): the id is the capability, so no token; but
			// never for a web page – a request with an Origin is refused, and no
			// CORS header is ever sent for it.
			name: 'share.read',
			method: 'GET',
			path: shareIdOf,
			scope: '',
			public: true,
			noOrigin: true,
			unauthenticatedOnly: true,
			run: ({ params }) => {
				const body = shares.read(params.id);
				if (body === null) return json(404, { error: 'no such share, or it expired' });
				log('a share was read');
				return { status: 200, text: body, contentType: 'application/json; charset=utf-8' };
			}
		},
		{
			name: 'share.create',
			method: 'POST',
			path: '/share',
			scope: 'bridge:share',
			body: 'json',
			bodyLimit: MAX_SHARE_BYTES + 4096,
			run: ({ body }) => {
				const minutes = Number(body?.minutes);
				if (
					typeof body?.scope !== 'string' ||
					typeof body?.redacted !== 'boolean' ||
					!Number.isFinite(minutes) ||
					body?.data === undefined
				) {
					return json(400, { error: 'scope, redacted, minutes and data are required' });
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
				return json(200, share);
			}
		},
		{
			name: 'share.list',
			method: 'GET',
			path: '/share',
			scope: 'bridge:share',
			run: () => json(200, { shares: shares.list() })
		},
		{
			name: 'share.revoke',
			method: 'DELETE',
			path: shareIdOf,
			scope: 'bridge:share',
			run: ({ params }) => {
				const ok = shares.revoke(params.id);
				log(ok ? 'a share was revoked' : 'revoke: no such share');
				return json(ok ? 200 : 404, { ok });
			}
		},
		{
			name: 'session.unpair',
			method: 'POST',
			path: '/unpair',
			scope: '',
			body: 'none',
			run: async ({ token }) => {
				await pairing.revoke(token);
				// The books' device key leaves with the pairing; the node runs on unarmed.
				await node?.disarm();
				log('a client unpaired itself');
				return json(200, { ok: true });
			}
		},
		{
			name: 'bank.accounts',
			method: 'GET',
			path: '/hibiscus/accounts',
			scope: 'bridge:bank:read',
			run: async () => {
				const accounts = (await allowedAccounts()).map(normalizeAccount);
				return json(200, { accounts });
			}
		},
		{
			name: 'bank.transactions',
			method: 'GET',
			path: '/hibiscus/transactions',
			scope: 'bridge:bank:read',
			run: async ({ query }) => {
				const accountId = query.get('account') ?? '';
				const since = query.get('since') ?? '';
				if (!/^[0-9A-Za-z_-]{1,40}$/.test(accountId))
					return json(400, { error: 'account is required' });
				if (!/^\d{4}-\d{2}-\d{2}$/.test(since))
					return json(400, { error: 'since must be YYYY-MM-DD' });
				// Only an allowed account; any other id looks like one that does not exist.
				const account = (await allowedAccounts()).find((k) => String(k.id) === accountId);
				if (!account) return json(404, { error: 'unknown account' });
				const normalized = normalizeAccount(account);
				const raw = await /** @type {() => import('./hibiscus.js').HibiscusClient} */ (
					hibiscus
				)().transactions(accountId, since);
				const transactions = raw
					// Defence in depth: nothing that Hibiscus files under another account.
					.filter((u) => u.konto_id === undefined || String(u.konto_id) === accountId)
					.map((u) => normalizeTransaction(u, normalized))
					.filter((t) => t.date === null || t.date >= since);
				return json(200, { account: normalized.id, since, transactions });
			}
		},
		{
			name: 'mail.messages',
			method: 'GET',
			path: '/mail/messages',
			scope: 'bridge:mail:read',
			run: async ({ query }) => {
				const since = query.get('since') ?? '';
				const until = query.get('until') || null;
				const scope = query.get('scope') ?? 'accounting';
				if (!isIsoDay(since)) return json(400, { error: 'since must be YYYY-MM-DD' });
				if (until !== null && (!isIsoDay(until) || until <= since)) {
					return json(400, { error: 'until must be a later YYYY-MM-DD' });
				}
				// The only scope there is: the private mailbox is read through /mail/search alone.
				if (scope !== 'accounting') return json(400, { error: 'scope must be accounting' });
				if (!mail) throw notSetUp('Mail');
				const messages = await mail.listMessages({ since, until });
				log(`listed ${messages.length} accounting mail(s)`);
				return json(200, {
					scope,
					accountingAddress: config.mail.accountingAddress,
					since,
					until,
					messages
				});
			}
		},
		{
			name: 'mail.attachment',
			method: 'GET',
			path: '/mail/attachment',
			scope: 'bridge:mail:read',
			run: async ({ query }) => {
				const id = query.get('id') ?? '';
				const part = query.get('part') ?? '';
				if (!decodeMailId(id)) return json(400, { error: 'id is not a mail id' });
				if (!isPartNumber(part)) return json(400, { error: 'part is not a part number' });
				if (!mail) throw notSetUp('Mail');
				const got = await mail.attachment(id, part);
				return bytes(got.bytes, got.mime);
			}
		},
		{
			name: 'mail.raw',
			method: 'GET',
			path: '/mail/raw',
			scope: 'bridge:mail:read',
			run: async ({ query }) => {
				const id = query.get('id') ?? '';
				if (!decodeMailId(id)) return json(400, { error: 'id is not a mail id' });
				if (!mail) throw notSetUp('Mail');
				const got = await mail.raw(id);
				log('handed out 1 mail as received');
				return bytes(got.bytes, got.mime);
			}
		},
		{
			name: 'mail.trash',
			method: 'POST',
			path: '/mail/trash',
			scope: 'bridge:mail:write',
			body: 'json',
			bodyLimit: 2000,
			run: async ({ body }) => {
				if (!decodeMailId(body?.id)) return json(400, { error: 'id must be a mail id' });
				if (!mail) throw notSetUp('Mail');
				const { trash } = await mail.trash(body.id);
				log('moved 1 mail to the Trash');
				return json(200, { trashed: true, trash });
			}
		},
		{
			name: 'mail.search',
			method: 'GET',
			path: '/mail/search',
			scope: 'bridge:mail:read',
			run: async ({ query }) => {
				const text = (query.get('text') ?? '').trim() || null;
				const amount = (query.get('amount') ?? '').trim() || null;
				const from = domainList(query.get('from'));
				if (from === null) return json(400, { error: 'from must be up to 3 mail domains' });
				// A crypto payment's hash, address or quantity: plain tokens only.
				const terms = query.getAll('term').map((t) => t.trim());
				if (terms.length > 6 || terms.some((t) => !/^[\w.,:-]{3,100}$/.test(t))) {
					return json(400, { error: 'term: up to 6, each 3–100 of letters, digits and .,:_-' });
				}
				const around = query.get('around') || null;
				const daysParam = query.get('days');
				const days = daysParam === null || daysParam === '' ? 14 : Number(daysParam);
				if (!text && !amount && !from.length && !terms.length)
					return json(400, { error: 'text, amount, from or term is required' });
				if (text && (text.length < 3 || text.length > 100 || /["\\\r\n]/.test(text))) {
					return json(400, { error: 'text must be 3–100 plain characters' });
				}
				if (amount && !/^-?[\d.,]{1,15}$/.test(amount)) {
					return json(400, { error: 'amount must look like 52,59' });
				}
				if (around !== null && !isIsoDay(around)) {
					return json(400, { error: 'around must be YYYY-MM-DD' });
				}
				if (!Number.isInteger(days) || days < 0 || days > 60) {
					return json(400, { error: 'days must be 0–60' });
				}
				if (!mail) throw notSetUp('Mail');
				const messages = await mail.search({ text, amount, from, terms, around, days });
				log(`search found ${messages.length} mail(s)`);
				return json(200, { messages });
			}
		},
		{
			name: 'llm.match',
			method: 'POST',
			path: '/match/assist',
			scope: 'bridge:llm',
			body: 'json',
			bodyLimit: MAX_EXTRACT_BODY,
			run: async ({ body }) => {
				const b = body?.booking;
				const list = body?.candidates;
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
					return json(400, { error: 'booking and 1–25 candidates are required' });
				}
				if (!llm || !matchAssist) throw notSetUp('LLM');
				const result = await withExtraTerms(body?.redactTerms, () =>
					matchAssist.pick({ booking: b, candidates: list })
				);
				log(
					`receipt pick: ${list.length} candidate(s), ${result.pick ? `pick ${result.pick.confidence}` : 'no pick'}`
				);
				return json(200, result);
			}
		},
		{
			name: 'llm.vendor',
			method: 'POST',
			path: '/vendor/assist',
			scope: 'bridge:llm',
			body: 'json',
			bodyLimit: MAX_EXTRACT_BODY,
			run: async ({ body }) => {
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
				if (!ok) return json(400, { error: 'a vendor timeline with 1–120 rows is required' });
				if (!llm || !vendorAssist) throw notSetUp('LLM');
				const result = await withExtraTerms(body?.redactTerms, () => vendorAssist.explain(body));
				log(`vendor notes: ${body.rows.length} row(s), ${result.notes.length} note(s)`);
				return json(200, result);
			}
		},
		{
			name: 'llm.transfer',
			method: 'POST',
			path: '/transfer/assist',
			scope: 'bridge:llm',
			body: 'json',
			bodyLimit: MAX_EXTRACT_BODY,
			run: async ({ body }) => {
				const b = body?.booking;
				const list = body?.candidates;
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
					return json(400, { error: 'booking and 1–8 candidates are required' });
				}
				if (!llm || !transferAssist) throw notSetUp('LLM');
				const result = await withExtraTerms(body?.redactTerms, () =>
					transferAssist.pick({ booking: b, candidates: list })
				);
				log(
					`transfer pick: ${list.length} candidate(s), ${result.pick ? `pick ${result.pick.confidence}` : 'no pick'}`
				);
				return json(200, result);
			}
		},
		{
			name: 'llm.mail',
			method: 'POST',
			path: '/mail/assist',
			scope: 'bridge:llm',
			body: 'json',
			run: async ({ body }) => {
				const counterparty = typeof body?.counterparty === 'string' ? body.counterparty.trim() : '';
				const purpose = typeof body?.purpose === 'string' ? body.purpose : '';
				const amount = typeof body?.amount === 'string' && body.amount ? body.amount : null;
				const around = body?.around ?? null;
				const days = body?.days ?? 14;
				const knownDomains = domainList(
					Array.isArray(body?.knownDomains) ? body.knownDomains.join(',') : null
				);
				if (counterparty.length < 2 || counterparty.length > 200)
					return json(400, { error: 'counterparty must be 2–200 characters' });
				if (purpose.length > 1000) return json(400, { error: 'purpose is too long' });
				if (amount && !/^-?[\d.,]{1,15}$/.test(amount))
					return json(400, { error: 'amount must look like 52,59' });
				if (around !== null && !isIsoDay(around))
					return json(400, { error: 'around must be YYYY-MM-DD' });
				if (!Number.isInteger(days) || days < 0 || days > 60)
					return json(400, { error: 'days must be 0–60' });
				if (knownDomains === null)
					return json(400, { error: 'knownDomains must be up to 3 mail domains' });
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
				return json(200, result);
			}
		},
		{
			name: 'aleph.accounts',
			method: 'POST',
			path: '/aleph/accounts',
			scope: 'bridge:chains:read',
			body: 'json',
			run: async ({ body }) => {
				if (!aleph) return notSetUpAnswer.aleph;
				const api = apiOf(body?.api);
				const addresses = Array.isArray(body?.addresses) ? body.addresses.map(String) : null;
				if (!api) return json(400, { error: 'api must be an https:// URL' });
				if (!addresses) return json(400, { error: 'addresses is required' });
				const accounts = await aleph.accounts({ addresses, api });
				log(
					`aleph: ${addresses.length} address(es) asked, ${accounts.filter((/** @type {any} */ a) => a.credits > 0 || a.entries > 0).length} account(s)`
				);
				return json(200, { accounts });
			}
		},
		{
			name: 'aleph.statement',
			method: 'GET',
			path: '/aleph/statement',
			scope: 'bridge:chains:read',
			run: async ({ query }) => {
				if (!aleph) return notSetUpAnswer.aleph;
				const api = apiOf(query.get('api'));
				if (!api) return json(400, { error: 'api must be an https:// URL' });
				const statement = await aleph.statement({
					address: query.get('address') ?? '',
					month: query.get('month') ?? '',
					api
				});
				log(
					`aleph: statement, ${statement.entries} entr(ies), ${statement.usage.length} line(s), ${statement.difference === 0 ? 'balanced' : 'difference'}`
				);
				return json(200, statement);
			}
		},
		{
			name: 'backup.status',
			method: 'GET',
			path: '/backup/status',
			scope: 'bridge:backup',
			run: async () => {
				if (!alephBackup) return json(200, { aleph: { configured: false } });
				const address = await alephBackup.address();
				// What the account can still pay with; unknown when Aleph does not answer.
				const credits = aleph
					? await aleph
							.accounts({ addresses: [address], api: alephApi })
							.then((/** @type {any[]} */ list) => list[0]?.credits ?? 0)
							.catch(() => null)
					: null;
				return json(200, {
					aleph: {
						configured: true,
						address,
						credits,
						ingestUrl: alephBackup.ingestUrl,
						gateways: alephBackup.gateways,
						// Where the app signs and lists for itself (keeper.js); tests: a fake.
						apiHost: alephBackup.apiHost
					}
				});
			}
		},
		{
			name: 'backup.list',
			method: 'GET',
			path: '/backup/aleph/list',
			scope: 'bridge:backup',
			run: async () => {
				if (!alephBackup) return notSetUpAnswer.alephBackup;
				const backups = await alephBackup.list();
				log(`backup: ${backups.length} backup(s) listed`);
				return json(200, { backups });
			}
		},
		{
			// The app uploaded the sealed backup to Aleph's IPFS host itself; the
			// bridge only signs the STORE message that has Aleph keep it.
			name: 'backup.keep',
			method: 'POST',
			path: '/backup/aleph/pin',
			scope: 'bridge:backup',
			body: 'json',
			run: async ({ body }) => {
				if (!alephBackup) return notSetUpAnswer.alephBackup;
				let kept;
				try {
					kept = await alephBackup.pin(String(body?.cid ?? ''), {
						...(body?.ref === undefined ? {} : { ref: String(body.ref) }),
						...(body?.size === undefined ? {} : { size: body.size })
					});
				} catch (error) {
					throw alephBackupError(error);
				}
				log(`backup: kept on Aleph, ${kept.status}`);
				return json(200, kept);
			}
		},
		{
			name: 'backup.put',
			method: 'POST',
			path: '/backup/aleph',
			scope: 'bridge:backup',
			body: 'bytes',
			bodyLimit: MAX_BACKUP_BYTES,
			run: async ({ query, body }) => {
				if (!alephBackup) return notSetUpAnswer.alephBackup;
				const name = query.get('name') ?? 'belege-backup';
				if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name)) {
					return json(400, { error: 'name: letters, digits, dot, dash and underscore only' });
				}
				const sealed = /** @type {Uint8Array} */ (body);
				if (sealed.length === 0) return json(400, { error: 'the backup is empty' });
				let kept;
				try {
					kept = await alephBackup.put(new Uint8Array(sealed), { name });
				} catch (error) {
					throw alephBackupError(error);
				}
				log(`backup: ${sealed.length} byte(s) to Aleph, ${kept.status}`);
				return json(200, kept);
			}
		},
		{
			name: 'rates.rate',
			method: 'GET',
			path: '/rates',
			scope: 'bridge:chains:read',
			run: async ({ query }) => {
				if (!rates) return notSetUpAnswer.rates;
				const asset = query.get('asset') ?? '';
				const date = query.get('date') ?? '';
				if (!/^[A-Z0-9]{2,10}$/.test(asset)) return json(400, { error: 'asset is required' });
				const prefer = query.get('prefer');
				if (prefer !== null && prefer !== 'kraken') {
					return json(400, { error: 'prefer must be kraken' });
				}
				// A token not in the list: by its contract on its chain (issue #115).
				const contract = query.get('contract')?.toLowerCase() ?? null;
				const chain = query.get('chain');
				if (contract !== null && !/^0x[0-9a-f]{40}$/.test(contract)) {
					return json(400, { error: 'contract must be 0x + 40 hex' });
				}
				// With the booking's block and the token's decimals: its DEX pool, when CoinGecko has no rate (#163).
				const blockText = query.get('block');
				const decimalsText = query.get('decimals');
				if (blockText !== null && !/^[1-9]\d{0,11}$/.test(blockText)) {
					return json(400, { error: 'block must be a positive integer' });
				}
				if (decimalsText !== null && !/^\d{1,2}$/.test(decimalsText)) {
					return json(400, { error: 'decimals must be 0 to 99' });
				}
				return json(
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
		},
		{
			name: 'kraken.balances',
			method: 'GET',
			path: '/kraken/balances',
			scope: 'bridge:chains:read',
			run: async () => {
				if (!kraken) return notSetUpAnswer.kraken;
				const balances = await kraken.balances();
				log(`kraken: ${balances.length} balance(s)`);
				return json(200, { balances });
			}
		},
		{
			name: 'kraken.ledgers',
			method: 'GET',
			path: '/kraken/ledgers',
			scope: 'bridge:chains:read',
			run: async ({ query }) => {
				if (!kraken) return notSetUpAnswer.kraken;
				const since = query.get('since') ?? '';
				if (!isIsoDay(since)) return json(400, { error: 'since must be YYYY-MM-DD' });
				const { entries, transferRefs, transferRefsReason } = await kraken.ledgers(since);
				log(`kraken: ${entries.length} ledger entries since ${since}`);
				if (transferRefs === 'refused') {
					log(
						`kraken: deposits and withdrawals get no on-chain hash (${transferRefsReason}); does the key have Funds → Query?`
					);
				}
				return json(200, { since, entries, transferRefs });
			}
		},
		{
			name: 'paperless.documents',
			method: 'GET',
			path: '/paperless/documents',
			scope: 'bridge:paperless:read',
			run: async ({ query }) => {
				if (!paperless) return notSetUpAnswer.paperless;
				const since = query.get('since');
				if (since !== null && Number.isNaN(Date.parse(since))) {
					return json(400, { error: 'since must be an ISO date or time' });
				}
				const documents = await paperless.documents({ since });
				log(`paperless: ${documents.length} document(s)${since ? ' since the last import' : ''}`);
				return json(200, { documents });
			}
		},
		{
			name: 'paperless.search',
			method: 'GET',
			path: '/paperless/search',
			scope: 'bridge:paperless:read',
			run: async ({ query }) => {
				if (!paperless) return notSetUpAnswer.paperless;
				const documents = await paperless.search(query.get('query') ?? '');
				// A count, never the words searched for.
				log(`paperless: search, ${documents.length} document(s)`);
				return json(200, { documents });
			}
		},
		{
			name: 'paperless.document',
			method: 'GET',
			path: '/paperless/document',
			scope: 'bridge:paperless:read',
			run: async ({ query }) => {
				if (!paperless) return notSetUpAnswer.paperless;
				const id = Number(query.get('id'));
				const got = await paperless.document(id);
				log(`paperless: document ${id}, ${got.variant}, ${got.bytes.length} bytes`);
				return bytes(got.bytes, got.mime);
			}
		},
		{
			name: 'enablebanking.banks',
			method: 'GET',
			path: '/enablebanking/banks',
			scope: 'bridge:bank:read',
			run: async ({ query }) => {
				if (!enablebankingLinks) return notSetUpAnswer.enablebanking;
				return json(200, { banks: await enablebankingLinks.banks(query.get('country') ?? '') });
			}
		},
		{
			name: 'enablebanking.link',
			method: 'POST',
			path: '/enablebanking/link',
			scope: 'bridge:bank:link',
			body: 'json',
			run: async ({ body }) => {
				if (!enablebankingLinks) return notSetUpAnswer.enablebanking;
				return json(200, await enablebankingLinks.start(body ?? {}));
			}
		},
		{
			name: 'enablebanking.finish',
			method: 'POST',
			path: '/enablebanking/finish',
			scope: 'bridge:bank:link',
			body: 'json',
			run: async ({ body }) => {
				if (!enablebankingLinks) return notSetUpAnswer.enablebanking;
				return json(200, { link: await enablebankingLinks.finish(body ?? {}) });
			}
		},
		{
			name: 'enablebanking.accounts',
			method: 'GET',
			path: '/enablebanking/accounts',
			scope: 'bridge:bank:read',
			run: async () => {
				if (!enablebankingLinks) return notSetUpAnswer.enablebanking;
				return json(200, { accounts: await enablebankingLinks.accounts() });
			}
		},
		{
			name: 'enablebanking.transactions',
			method: 'GET',
			path: '/enablebanking/transactions',
			scope: 'bridge:bank:read',
			run: async ({ query }) => {
				if (!enablebankingLinks) return notSetUpAnswer.enablebanking;
				return json(
					200,
					await enablebankingLinks.transactions(
						query.get('account') ?? '',
						query.get('since') ?? ''
					)
				);
			}
		},
		{
			name: 'enablebanking.links',
			method: 'GET',
			path: '/enablebanking/links',
			scope: 'bridge:bank:read',
			run: async () => {
				if (!enablebankingLinks) return notSetUpAnswer.enablebanking;
				return json(200, { links: await enablebankingLinks.list() });
			}
		},
		{
			name: 'enablebanking.unlink',
			method: 'DELETE',
			path: linkIdOf,
			scope: 'bridge:bank:link',
			run: async ({ params }) => {
				if (!enablebankingLinks) return notSetUpAnswer.enablebanking;
				await enablebankingLinks.unlink(params.id);
				return json(200, { ok: true });
			}
		},
		{
			// Own wallets: GET /chains, POST /<chain>/wallet (chains/index.js).
			name: 'chains.list',
			method: 'GET',
			path: '/chains',
			scope: 'bridge:chains:read',
			run: async () => {
				if (!wallets) return notSetUpAnswer.wallets;
				// Whether an Alchemy key is set up (EVM wallets are then read there); never the key.
				return json(200, { chains: wallets.chains(), alchemy: await wallets.alchemy() });
			}
		},
		{
			name: 'lanRelay.status',
			method: 'GET',
			path: '/lan-relay',
			scope: 'bridge:chains:read',
			run: () =>
				// The address the books keep, so own devices find it; counts, never who.
				json(200, {
					configured: Boolean(lanRelay),
					running: Boolean(lanRelay?.addr),
					addr: lanRelay?.addr ?? null,
					...(lanRelay?.addr ? lanRelay.stats() : {})
				})
		},
		{
			name: 'chains.bitcoinKey',
			method: 'GET',
			path: '/bitcoin/key',
			scope: 'bridge:chains:read',
			run: async () => {
				if (!wallets) return notSetUpAnswer.wallets;
				const fingerprint = await wallets.bitcoinKey();
				return json(200, { configured: Boolean(fingerprint), fingerprint });
			}
		},
		{
			// A POST, so the address is in no URL and no access log.
			name: 'chains.akashDeployments',
			method: 'POST',
			path: '/akash/deployments',
			scope: 'bridge:chains:read',
			body: 'json',
			run: async ({ body }) => {
				if (!wallets) return notSetUpAnswer.wallets;
				const result = await wallets.akashDeployments(body);
				log(`akash: ${result.deployments.length} deployment(s)`);
				return json(200, result);
			}
		},
		{
			// A POST, so the address is in no URL and no access log.
			name: 'chains.wallet',
			method: 'POST',
			path: walletChainOf,
			scope: 'bridge:chains:read',
			body: 'json',
			run: async ({ params, body }) => {
				const result = await wallets.sync({ ...body, chain: params.chain });
				log(
					`${result.chain}: ${result.transactions} transaction(s), ${result.entries.length} entries, ${result.balances.length} balance(s), ${result.unknownAssets} unknown asset(s)${result.unknownStatus ? `, ${result.unknownStatus} without a receipt status (value not booked)` : ''}`
				);
				return json(200, result);
			}
		},
		{
			// What the app shows under Integrationen → "KI – Beleg-Auslesen". The
			// host only (no path, no query, no user:password@), the model names, and
			// whether a key is there – never the key, never the terms themselves.
			name: 'llm.status',
			method: 'GET',
			path: '/llm/status',
			scope: 'bridge:llm',
			run: async () => {
				let provider = null;
				try {
					provider = new URL(config.llm.baseUrl).host || null;
				} catch {
					provider = null;
				}
				let keyConfigured = false;
				try {
					keyConfigured = (await llmKeyPresent()) === true;
				} catch {
					keyConfigured = false;
				}
				return json(200, {
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
					// The provider's last refusal since the bridge started (#417): no credit, key, …
					lastRefusal: llm?.lastRefusal?.() ?? null,
					redactTerms: config.llm.redactTerms.length,
					// Whether text is blacked out before it goes to the model (#423); `local`: it
					// goes unredacted to a model setup:llm was told runs on this machine.
					redaction: {
						mode: config.llm.redaction,
						active: !redactionOff(config.llm),
						local: redactionOff(config.llm) && !redactionOffForEnclave(config.llm),
						// Off because the model runs in the attested enclave (#416), not here.
						enclave: redactionOffForEnclave(config.llm)
					},
					mail: { authServId: config.mail.authServId ?? null },
					// A confidential model (#416): the pinned enclave and how its last proof went.
					tee: llmTee ? llmTee() : null
				});
			}
		},
		{
			name: 'llm.extract',
			method: 'POST',
			path: '/extract',
			scope: 'bridge:llm',
			body: 'json',
			bodyLimit: MAX_EXTRACT_BODY,
			run: async ({ body }) => {
				if (typeof body?.text !== 'string' || !body.text.trim()) {
					return json(400, { error: 'text is required' });
				}
				/** @type {Record<string, string>} */
				const hints = {};
				for (const k of ['subject', 'from', 'fileName', 'receivedAt']) {
					if (typeof body.hints?.[k] === 'string') hints[k] = body.hints[k];
				}
				const mailId = body.source?.mailId;
				if (mailId !== undefined && mailId !== null) {
					if (!decodeMailId(mailId)) return json(400, { error: 'source.mailId is not a mail id' });
					if (!mail) throw notSetUp('Mail');
					// The bridge checks the sender itself; the app's word is not enough.
					const { verdict, outgoing } = await mail.verdictOf(mailId);
					if (verdict !== 'pass' && !outgoing && body.confirmedByUser !== true) {
						log(`refused /extract for a mail whose sender did not pass (${verdict})`);
						return json(403, {
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
				return json(200, result);
			}
		}
	];

	return commands;
}

/**
 * The command for a request, with the path's parameters; null when none
 * matches. A request with a token never matches a command that is only for
 * callers without one (a share read by its id).
 *
 * @param {Command[]} commands
 * @param {{ method: string, path: string, hasToken: boolean }} r
 * @returns {{ command: Command, params: Record<string, string> } | null}
 */
export function findCommand(commands, { method, path, hasToken }) {
	for (const command of commands) {
		if (command.method !== method) continue;
		if (command.unauthenticatedOnly && hasToken) continue;
		if (typeof command.path === 'string') {
			if (command.path === path) return { command, params: {} };
			continue;
		}
		const params = command.path(path);
		if (params) return { command, params };
	}
	return null;
}
