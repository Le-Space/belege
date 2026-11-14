// The bridge's HTTP API, on 127.0.0.1 only: one front door to the commands
// in commands.js (the other is the stream of the bridge's node, stream.js).
//
//   GET  /health                         no token
//   POST /pair         { code }          no token → { token }
//   GET  /hibiscus/accounts              token
//   GET  /hibiscus/transactions?account=<id>&since=YYYY-MM-DD   token
//   GET  /mail/messages?since=YYYY-MM-DD[&until=YYYY-MM-DD]&scope=accounting   token
//   GET  /mail/attachment?id=<mail id>&part=<n>                   token → the bytes
//   GET  /mail/raw?id=<mail id>                                   token → the mail as received (message/rfc822), to the accounting address only (#288)
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
//   POST /travel/assist { lang, trip, legs, receipts, questions }  token → up to six notes on a trip; only unredacted, model here or in the enclave
//   POST /booking/assist { booking, receipt, learned, accounts }  token → up to two accounts of the chart for a payment's "Konto"
//   POST /transfer/assist { booking, candidates }               token → the LLM's pick of an own transfer's other side
//   GET  /llm/status                                              token → provider, models, key present?, redaction on/off, the TEE pin and its last proof
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
//   GET  /paperless/documents[?since=<ISO>]                       token → Paperless-ngx documents added since, with OCR text (paperless.js)
//   GET  /paperless/search?query=<text>                           token → Paperless' full-text search, at most 25 documents, no OCR text
//   GET  /paperless/document?id=<n>                               token → its bytes: the original PDF or image, else the archive PDF
//   GET  /chains                                                  token → chains, endpoints, explorers, alchemy: bool (@le-space/chains)
//   GET  /bitcoin/key                                             token → the zpub's fingerprint, never the zpub
//   GET  /lan-relay                                               token → the relay for own devices in the own network: its address (lan-relay.js)
//   POST /node/scopes { peerId, scopes }                          token → what one device may call over the stream (grants.js, #579)
//   POST /<chain>/wallet { address, endpoints? }                  token → an own wallet's transfers and balance
//   POST /akash/deployments { address, endpoints? }               token → an Akash wallet's deployments, what each cost, and the ACT it holds (#305)
//   POST /aleph/accounts { addresses, api? }                      token → which are Aleph accounts: credits, entries (aleph.js)
//   GET  /aleph/statement?address=0x…&month=YYYY-MM[&api=]        token → a month's credits: balances, top-ups, usage per day
//   GET  /backup/status                                           token → { aleph: { configured, address, credits, ingestUrl, gateways, apiHost } } (aleph-backup.js)
//   GET  /backup/aleph/list                                       token → { backups: [{ cid, at, itemHash }] }: what this account had Aleph keep
//   POST /backup/aleph/pin { cid, ref? }                          token → { cid, address, itemHash, status, ref? }: what the app uploaded, kept; an increment's ref is its base's CID
//   POST /backup/aleph?name=<file name>  (the sealed bytes)       token → { cid, size, address, itemHash, status }: uploaded and kept
//   /portals…          customer portals (portals/routes.js)            token
//
// Guards, in this order, on every request:
//   1. Host header is 127.0.0.1:<port> or localhost:<port> (DNS rebinding)
//   2. an Origin, when there is one, is in `appOrigins` (CORS; others get 403
//      and no CORS headers, so a foreign page cannot read anything)
//   3. a bearer token whose hash is on file, except for /health and /pair
//
// Then the command: its body read within its limit, its `run` with the
// parsed input, its answer written. What a command checks of its input, and
// what leaves the bridge (Hibiscus accounts only with an allowed IBAN suffix,
// for one), is the command's business, in commands.js.

import http from 'node:http';

import { createShares } from './shares.js';
import { handlePortalRequest } from './portals/routes.js';
import { ALEPH_API } from '@le-space/chains/aleph';
import { MAX_BODY, createCommands, errorJson, findCommand, statusOf } from './commands.js';

export const LOOPBACK = '127.0.0.1';

/**
 * @param {object} options
 * @param {import('./config.js').BridgeConfig} options.config
 * @param {ReturnType<typeof import('./pairing.js').createPairing>} options.pairing
 * @param {(() => import('./hibiscus.js').HibiscusClient) | null} options.hibiscus
 *   null when Hibiscus is not set up yet
 * @param {import('./mail/imap.js').MailClient | null} [options.mail] null when mail is not set up
 * @param {import('./llm/extract.js').Extractor | null} [options.llm] null when no LLM is set up
 * @param {(() => object) | null} [options.llmTee] a confidential model's pin and last proof (#416, llm/confidential.js)
 * @param {() => Promise<boolean>} [options.llmKeyPresent] whether the keychain holds an API key;
 *   says yes or no, never hands the key out
 * @param {ReturnType<typeof import('./llm/assist.js').createMailAssist> | null} [options.assist]
 *   "Mit KI weitersuchen": null without mail or LLM
 * @param {ReturnType<typeof import('./llm/match-assist.js').createMatchAssist> | null} [options.matchAssist]
 * @param {ReturnType<typeof import('./llm/transfer-assist.js').createTransferAssist> | null} [options.transferAssist]
 * @param {ReturnType<typeof import('./llm/vendor-assist.js').createVendorAssist> | null} [options.vendorAssist]
 * @param {ReturnType<typeof import('./llm/travel-assist.js').createTravelAssist> | null} [options.travelAssist]
 * @param {ReturnType<typeof import('./llm/booking-assist.js').createBookingAssist> | null} [options.bookingAssist]
 * @param {ReturnType<typeof createShares>} [options.shares] read shares for an assistant, in memory
 *   "✦ KI-Vorschlag" under "Beleg zuordnen": null without an LLM
 * @param {import('./portals/manager.js').PortalManager | null} [options.portals] the portal connector
 * @param {ReturnType<typeof import('@le-space/rates').createRateService> | null} [options.rates] exchange rates
 * @param {ReturnType<typeof import('./kraken.js').createKrakenClient> | null} [options.kraken] null when Kraken is not set up
 * @param {ReturnType<typeof import('./paperless.js').createPaperlessClient> | null} [options.paperless]
 *   Paperless-ngx as a receipt source (issue #318): null when not set up
 * @param {ReturnType<typeof import('./enablebanking.js').createEnableBankingClient> | null} [options.enablebanking]
 *   the own Enable Banking application: null when not set up (issue #224)
 * @param {ReturnType<typeof import('./enablebanking-links.js').createEnableBankingLinks> | null} [options.enablebankingLinks]
 *   linking a bank through it: null when not set up
 * @param {ReturnType<typeof import('@le-space/chains').createWalletService> | null} [options.wallets] own wallets on public chains
 * @param {ReturnType<typeof import('@le-space/chains/aleph').createAlephClient> | null} [options.aleph] Aleph Cloud credits, read only
 * @param {boolean} [options.alephLoopback] tests: an Aleph API on 127.0.0.1
 * @param {string} [options.alephApi] the Aleph API asked when the request names none
 * @param {ReturnType<typeof import('./aleph-backup.js').createAlephBackup> | null} [options.alephBackup]
 *   the backup's copy on Aleph, with the bridge's own key (issue #77)
 * @param {{ addr: string | null, stats: () => { reservations: number, connections: number } } | null} [options.lanRelay]
 *   the relay for own devices (lan-relay.js): null when not set up, `addr` null when it did not start
 * @param {{ status: () => object, disarm: () => Promise<void> } | null} [options.node] the bridge's libp2p node (node.js, #573)
 * @param {(() => Promise<{ config: object, secrets: Record<string, string> }>) | null} [options.settingsExport]
 *   what a hosted bridge may take over (#728); over the stream only, to the device that paired
 * @param {(message: string) => void} [options.log] never gets a secret, bank data, mail or receipt text
 */
export function createBridgeServer({
	config,
	pairing,
	hibiscus,
	mail = null,
	llm = null,
	llmKeyPresent = async () => false,
	llmTee = null,
	assist = null,
	matchAssist = null,
	transferAssist = null,
	vendorAssist = null,
	travelAssist = null,
	bookingAssist = null,
	shares = createShares(),
	portals = null,
	rates = null,
	kraken = null,
	paperless = null,
	enablebanking = null,
	enablebankingLinks = null,
	wallets = null,
	aleph = null,
	alephLoopback = false,
	alephApi = ALEPH_API,
	alephBackup = null,
	lanRelay = null,
	node = null,
	settingsExport = null,
	log = () => {}
}) {
	const allowedOrigins = new Set(config.appOrigins.map((o) => o.replace(/\/$/, '')));
	const commands = createCommands({
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
		travelAssist,
		bookingAssist,
		shares,
		rates,
		kraken,
		paperless,
		enablebanking,
		enablebankingLinks,
		wallets,
		aleph,
		alephLoopback,
		alephApi,
		alephBackup,
		lanRelay,
		portals,
		node,
		settingsExport,
		log
	});

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
	 * @param {Uint8Array} bytes
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

	/** A command's answer onto the wire. @param {http.ServerResponse} res @param {import('./commands.js').Answer} answer */
	function sendAnswer(res, answer) {
		if ('bytes' in answer) return sendBytes(res, answer.bytes, answer.mime);
		if ('text' in answer) {
			res.writeHead(answer.status, {
				'Content-Type': answer.contentType,
				'Content-Length': Buffer.byteLength(answer.text),
				'Cache-Control': 'no-store',
				'X-Content-Type-Options': 'nosniff'
			});
			return res.end(answer.text);
		}
		return send(res, answer.status, answer.json);
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

	/**
	 * @param {http.IncomingMessage} req
	 * @param {http.ServerResponse} res
	 * @param {URL} url
	 */
	async function route(req, res, url) {
		const path = url.pathname.replace(/\/+$/, '') || '/';
		const token = bearer(req);
		const found = findCommand(commands, {
			method: String(req.method),
			path,
			hasToken: req.headers.authorization !== undefined
		});

		if (found) {
			const { command, params } = found;
			// Only over the stream, to a proved device (stream.js): never to a page.
			if (command.streamOnly) return send(res, 404, { error: 'not found' });
			if (command.noOrigin && req.headers.origin !== undefined) {
				return send(res, 403, { error: 'a share is not for a web page' });
			}
			if (!command.public && !pairing.verify(token)) {
				return send(res, 401, { error: 'unauthorized' });
			}
			const kind = command.body ?? (command.method === 'GET' ? 'none' : 'json');
			const body =
				kind === 'json'
					? await readJson(req, command.bodyLimit ?? MAX_BODY)
					: kind === 'bytes'
						? new Uint8Array(await readBytes(req, command.bodyLimit ?? MAX_BODY))
						: {};
			const answer = await command.run({ query: url.searchParams, params, body, token });
			return sendAnswer(res, answer);
		}

		// Nothing else answers without the token.
		if (!pairing.verify(token)) {
			return send(res, 401, { error: 'unauthorized' });
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
				log(
					`refused origin ${JSON.stringify(origin).slice(0, 80)} – to let it in: pnpm setup:origins -- --add ${String(origin).slice(0, 80)}, then restart the bridge`
				);
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
			// Messages are the bridge's own; they carry no password, no bank data and no mail text.
			const { json, line } = errorJson(error);
			log(`${req.method} ${url.pathname}: ${line}`);
			if (!res.headersSent) send(res, statusOf(error), json);
		}
	});

	return {
		server,
		/** The commands this bridge serves: what the node offers over the stream too (stream.js). */
		commands,
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
