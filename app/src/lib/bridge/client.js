import { intlLocale, t } from '../i18n/index.js';
import { noteWayOut, wayOutKind } from '../help/way-out.js';
import { checkArgs, command as specOf, httpRequest } from '@le-space/bridge-protocol';
import { scopeLabel } from './scopes.js';
// The app's side of the bridge on 127.0.0.1 (see bridge/README.md).
//
// Every call names a command of @le-space/bridge-protocol (#577) with its
// arguments; the catalogue says how HTTP carries it. The fetch gets both: the
// HTTP request, and the command in `init.command` – a transport that talks to
// the bridge's node (sync/remote-bridge.js) calls it by its name there, plain
// fetch ignores it. No path is built here.

/**
 * @typedef {{ gave: { asset: string, amount: string, listed: boolean }[], got: { asset: string, amount: string, listed: boolean }[], via: string, fee?: { asset: string, amount: string }, storage?: { asset: string, amount: string } }} SwapSides
 *   `storage`: NEAR, what the storage deposits made for the swap kept
 */

/**
 * @typedef {{ direction?: 'in' | 'out', amount?: string, quantity?: string, asset?: string, day?: string, account?: string, counterparty?: string, purpose?: string }} TransferAssistBooking
 */

/**
 * @typedef {{ id: string, scope: string, redacted: boolean, createdAt: string, expiresAt: string, reads: number }} ShareInfo
 */

export const DEFAULT_BRIDGE_URL = import.meta.env?.VITE_BRIDGE_URL || 'http://127.0.0.1:8765';

/**
 * Whether a saved pairing (settings `bridge`) lets this device call the
 * bridge: a token over HTTP, or the bridge's own node, a device of the books,
 * over the stream (#575). Only HTTP knows a token; `token` stays null then.
 *
 * @template {{ token?: string | null, peerId?: string | null }} T
 * @param {T | null | undefined} saved
 * @returns {saved is T}
 */
export const pairedWith = (saved) => Boolean(saved?.token || saved?.peerId);

export class BridgeError extends Error {
	/** @param {string} message @param {number} status @param {string | null} [code] the bridge's */
	constructor(message, status, code = null) {
		super(message);
		this.name = 'BridgeError';
		this.status = status;
		this.code = code;
	}
}

/** The bridge's codes for a language-model provider that refuses (bridge/src/llm/extract.js REFUSALS). */
export const LLM_REFUSALS = new Set([
	'LLM_NO_CREDIT',
	'LLM_AUTH',
	'LLM_MODEL',
	'LLM_UNREACHABLE',
	// The bridge's own limit for this device: the model's tokens for today (#579).
	'BRIDGE_LLM_DAY'
]);
/** Why a model's enclave was not reached, as the bridge found it: each with its own message. */
const ENCLAVE_REACH = new Set(['port', 'host', 'proof']);
/** The bridge's codes for a Paperless that cannot be used (bridge/src/paperless.js), each with its own message. */
const PAPERLESS_ERRORS = new Set([
	'PAPERLESS_UNREACHABLE',
	'PAPERLESS_TIMEOUT',
	'PAPERLESS_AUTH',
	'PAPERLESS_TOO_LARGE',
	'PAPERLESS_NOT_A_RECEIPT'
]);
/** What the bridge's node refuses this device (bridge grants.js, #579): said as such. */
const GRANT_REFUSALS = new Set([
	'BRIDGE_SCOPE_MISSING',
	'BRIDGE_GRANT_EXPIRED',
	'BRIDGE_BACKUP_HOUR'
]);

/** A provider's host as people know it. @param {unknown} host */
export function providerName(host) {
	const h = String(host ?? '');
	if (/(^|\.)deepseek\.com$/.test(h)) return 'DeepSeek';
	if (/(^|\.)libertai\.io$/.test(h)) return 'LibertAI';
	if (/:11434$/.test(h)) return 'Ollama';
	if (/:1234$/.test(h)) return 'LM Studio';
	return h || 'KI-Anbieter';
}

/** @type {() => string[]} what the app adds to the bridge's redaction list on every LLM call */
let redactTerms = () => [];

/**
 * Tell the client which terms to send with every call that reaches the
 * language model: the company's names from Einstellungen (issue #226). The
 * bridge blacks them out beside its own list.
 *
 * @param {() => string[]} terms
 */
export function setRedactTerms(terms) {
	redactTerms = terms;
}

/** What the bridge puts where one of those terms stood (bridge/src/llm/redact.js). */
const COMPANY_MARK = '[FIRMA]';

/**
 * The first company name back where the model repeats the bridge's mark: an
 * invoice of our own names us as the vendor, and is recognised by that name.
 *
 * @template T
 * @param {T} result
 * @returns {T}
 */
function restoreCompany(result) {
	const [name] = redactTerms();
	const e = /** @type {any} */ (result)?.extraction;
	if (!name || !e) return result;
	for (const key of ['vendor', 'summary']) {
		if (typeof e[key] === 'string') e[key] = e[key].split(COMPANY_MARK).join(name);
	}
	return result;
}

/** A body for an LLM route: the caller's, and the terms to black out. @param {any} body */
const withTerms = (body) => ({ ...body, redactTerms: redactTerms().slice(0, 20) });

/**
 * A failed call, with its way out noted for the card that shows the message
 * (help/way-out.js).
 *
 * @param {string} message
 * @param {number} status
 * @param {{ code?: string, error?: string } | null} body
 * @param {import('../help/way-out.js').WayOutKind | null} [kind] the way out, when the answer alone does not say it
 */
function failed(message, status, body, kind = wayOutKind(status, body)) {
	noteWayOut(message, kind);
	return new BridgeError(message, status, body?.code ?? null);
}

/**
 * @typedef {object} BridgeAccount
 * @property {string} id
 * @property {string} ibanMasked
 * @property {string} ibanLast4
 * @property {string} name
 * @property {string} currency
 * @property {number | null} balanceCents
 * @property {string | null} balanceDate
 */

/**
 * @typedef {object} KrakenBalance
 * @property {string} asset symbol
 * @property {'spot' | 'earn'} wallet
 * @property {string} amount decimal
 * @property {number} decimals
 */

/**
 * @typedef {object} KrakenLedgerEntry
 * @property {string} id
 * @property {string} refid shared by the legs of a trade or a transfer
 * @property {string} time ISO 8601
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {string} type
 * @property {string} subtype
 * @property {string} asset symbol
 * @property {'spot' | 'earn'} wallet
 * @property {string} amount signed decimal, before the fee
 * @property {string} fee decimal, charged on top
 * @property {number} decimals
 * @property {string} [transferRef] a deposit's or withdrawal's txid: the on-chain hash, or the bank's reference
 * @property {string} [transferMethod] the network as Kraken names it (`Filecoin`, `Ether (Arbitrum One)`)
 * @property {string} [transferAddress] a crypto withdrawal: the address it went to
 * @property {string} [balance] the asset's balance on Kraken after this entry, decimal; '' when none (#287)
 * @property {string} [code] Kraken's asset code (`XXBT`, `DOT.S`): whose balance `balance` is
 */

/**
 * @typedef {object} WalletEntry what the bridge reads from an own wallet (packages/chains/)
 * @property {string} id stable: Cosmos `<hash>:m<msg>:e<event>.<n>:<asset>`, EVM `<hash>:value` / `:erc20:…` or `:log:<i>` / `:internal:<i>` (Alchemy: `:internal:trace:<address>`); the fee `<hash>:fee`
 * @property {string} hash as the chain gives it
 * @property {number} height
 * @property {string} time ISO 8601
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {'sent' | 'received' | 'fee'} type
 * @property {'transfer' | 'reward' | 'stake' | 'ibc' | 'fee' | 'swap' | 'mining'} kind `mining`: a mined block (Monero export)
 * @property {SwapSides} [swap] EVM: what the wallet gave and got in a swap (issue #115)
 * @property {string} [partOf] NEAR: a storage deposit made for a swap in another transaction, or that transaction's gas (type `fee`): the swap's hash (#968)
 * @property {string} asset symbol
 * @property {string} amount signed decimal
 * @property {number} decimals
 * @property {string} counterparty the other address, '' for a fee
 * @property {string} counterpartyLabel a module's name (staking, rewards), or ''
 * @property {string} memo
 * @property {boolean} success
 * @property {string} explorerUrl
 * @property {string} [contract] EVM: a token not in the chain's list, by its contract (#115)
 * @property {boolean} [listed] false for such a token
 * @property {string} [ibcMemo] Cosmos: an IBC transfer's own memo (MsgTransfer.memo) – where a wallet's swap puts its plan (#170)
 * @property {boolean} [byOther] EVM: sent out in a transaction this address did not send – a token project's burn, say (#162)
 * @property {string} [txFrom] who sent that transaction, where the bridge knows it
 */

/**
 * @typedef {object} AkashDeployment one deployment and what it cost (packages/chains/src/akash-deployments.js)
 * @property {string} dseq
 * @property {string} state active | closed
 * @property {number} createdHeight
 * @property {string | null} createdAt ISO
 * @property {number} settledHeight
 * @property {string | null} settledAt ISO, the last settlement
 * @property {string} transferred ACT paid to the providers, decimal
 * @property {string} funds ACT left in the escrow, decimal
 */

/**
 * @typedef {object} WalletHistory
 * @property {string} chain
 * @property {Record<string, string>} endpoints the ones asked
 * @property {WalletEntry[]} entries oldest first
 * @property {{ asset: string, amount: string, decimals: number }[]} balances
 * @property {number} transactions
 * @property {number} unknownAssets denoms or tokens that are not booked
 * @property {string[]} [superseded] ids of entries an earlier reading gave and this one leaves out,
 *   because they are part of another entry now (NEAR handed to the wrap contract, wallets/wallet-sync.js)
 * @property {{ earliestHeight: number, earliestTime: string | null, pruned: boolean, completedBy?: 'indexer', unknownAmounts?: number, indexerFrom?: string | null, indexerError?: string }} history
 *   `completedBy`: a pruned node's older part came from the chain's indexer (Akash, issue #105);
 *   `unknownAmounts`: older transactions whose amount only events carry, not booked
 * @property {string} addressUrl
 * @property {'alchemy' | 'blockscout'} [source] EVM: where it was read
 * @property {{ asset: string, decimals: number, points: { time: string, value: string }[], source?: 'explorer' | 'history' }[]} [balanceHistory]
 *   the source's balance after each change, in smallest units, oldest first (#287): Blockscout's of the
 *   native coin (`explorer`, the default), or a wallet's own running balance (`history`, the Monero CLI export)
 */

/**
 * @typedef {object} ChainInfo one of GET /chains
 * @property {string} id
 * @property {'cosmos' | 'evm'} kind
 * @property {string} name
 * @property {string} shortName
 * @property {string[]} assets
 * @property {string} nativeSymbol
 * @property {string} [bech32Prefix]
 * @property {Record<string, string>} endpoints
 * @property {Record<string, string[]>} alternatives
 * @property {{ name: string, tx: string, address: string }} explorer
 * @property {boolean} [alchemySupported] EVM: read through Alchemy when a key is set up
 * @property {boolean} [alchemyInternal] EVM: Alchemy has its internal transfers too
 */

/**
 * @typedef {object} AlephStatement packages/chains/src/aleph.js `statement`
 * @property {string} address
 * @property {string} month YYYY-MM
 * @property {string} from ISO, UTC
 * @property {string} until ISO, UTC
 * @property {number} opening credits
 * @property {number} closing credits
 * @property {{ time: string, credits: number, bonus: number, how: 'purchase' | 'transfer', price: string | null, usd?: string | null, usdPerCredit?: string | null, tokenAmount?: string | null, priceBasis?: 'price' | 'list' | null, token: string | null, chain: string | null, txHash: string | null, from: string }[]} topUps
 * @property {{ time: string, credits: number, price: string, token: string | null, chain: string | null, txHash: string }[]} [purchases] every purchase up to the month's end, with its paying transaction; not from an older bridge
 * @property {{ time: string, credits: number, to: string }[]} transfersOut
 * @property {{ date: string, kind: string, resource: string | null, credits: number, entries: number, resources: number, sizeMib: number | null, usdPerCredit: string, priceSource: 'purchase' | 'list', eurPerUsd: string | null, eurCents: number | null }[]} usage
 * @property {Record<string, { type: string, name: string }>} resources
 * @property {{ topUps: number, transfersOut: number, usage: number, eurCents: number | null }} totals
 * @property {number} difference opening + in − out − closing; 0 when the history is complete
 * @property {string | null} rateSource
 * @property {number} entries
 */

/**
 * @typedef {object} FilecoinPayStatement packages/chains/src/filecoin-pay.js `statement`, as the bridge answers it
 * @property {string} address the payer, 0x… in lower case
 * @property {string} filecoinAddress the same account, f410f…
 * @property {string} month YYYY-MM
 * @property {string} from ISO, UTC
 * @property {string} until ISO, UTC
 * @property {string} asset USDFC
 * @property {number} decimals
 * @property {string} opening the balance in the contract when the month began, a decimal
 * @property {string} closing
 * @property {{ time: string, amount: string, other: string, txHash: string }[]} deposits paid in
 * @property {{ time: string, amount: string, other: string, txHash: string }[]} withdrawals taken out
 * @property {{ time: string, date: string, railId: string, payee: string, service: string, oneTime: boolean, amount: string, toPayee: string, commission: string, networkFee: string, paidUntil: string | null, txHash: string, eurPerUnit: string | null, eurCents: number | null }[]} usage one line per settlement of a rail
 * @property {Record<string, { id: string, payee: string, operator: string, service: string, commissionBps: number, createdAt: string }>} rails the rails the month used
 * @property {number} railCount every rail the payer has
 * @property {{ deposits: string, withdrawals: string, usage: string, eurCents: number | null }} totals
 * @property {{ funds: string, lockedUp: string, at: string }} now the balance now, not at the month's end
 * @property {string | null} rateSource
 * @property {'index' | 'logs'} source where the lines come from
 * @property {string | null} indexFailed why the index was passed over
 * @property {'events' | 'transfers'} movementsFrom `transfers`: what another address paid in is missing
 * @property {number} entries
 * @property {boolean} [blockscoutKey] whether the bridge asked Blockscout with a key; never the key
 */

/**
 * How the bridge is reached when a caller names no fetch: plain fetch, or –
 * with device sync – the bridge on this machine first and an own desktop's
 * over UCEP otherwise (sync/remote-bridge.js, issue #142).
 *
 * @type {typeof fetch | null}
 */
let transport = null;

/** @param {typeof fetch | null} fetchLike */
export function setBridgeTransport(fetchLike) {
	transport = fetchLike;
}

/**
 * Which bridge the books expect to answer (integrations/bridge-status.js
 * `expectedBridge`), asked when none does: the session reads it from the
 * sealed settings. null: not known – the text is the one for a bridge on a
 * computer then, as before.
 *
 * @type {() => ('aleph' | 'near' | 'local' | null) | Promise<'aleph' | 'near' | 'local' | null>}
 */
let expected = () => null;

/** @param {typeof expected} which */
export function setExpectedBridge(which) {
	expected = which;
}

/**
 * What to say when the bridge does not answer: for a hosted bridge where its
 * VM is started and unlocked – never whether `pnpm bridge` runs.
 *
 * @param {'unreachable' | 'nodeUnreachable'} key the text for a bridge on a computer
 * @param {number} status
 * @param {{ code?: string, error?: string } | null} body
 */
async function silent(key, status, body) {
	/** @type {Awaited<ReturnType<typeof expected>>} */
	let which = null;
	try {
		which = await expected();
	} catch {
		// not known
	}
	// A hosted bridge is started and unlocked on its page, not in a terminal.
	return which === 'aleph' || which === 'near'
		? failed(t(`messages.bridge.hostedUnreachable.${which}`), status, body, 'hosted')
		: failed(t(`messages.bridge.${key}`), status, body);
}

/**
 * How this page reaches its own bridge now: the transport the session set
 * (the bridge's node over a stream first), else plain fetch. The desktop's
 * forwarding to own devices calls its bridge this way (#580).
 *
 * @type {typeof fetch}
 */
export const bridgeTransportFetch = (input, init) => (transport ?? fetch)(input, init);

/** Resolved while no transport is being set up; calls wait on it. */
let transportReady = Promise.resolve();

/**
 * Calls wait while the session sets the transport up after an unlock (device
 * sync, the bridge's node): a page that calls the bridge at once – the bank's
 * return page – would otherwise go past the stream to HTTP (#575). At most
 * `maxMs`; the returned function ends the wait sooner.
 *
 * @param {number} [maxMs]
 * @returns {() => void}
 */
export function holdBridgeTransport(maxMs = 30_000) {
	/** @type {() => void} */
	let done = () => {};
	transportReady = new Promise((resolve) => (done = () => resolve(undefined)));
	const timer = setTimeout(done, maxMs);
	return () => {
		clearTimeout(timer);
		done();
	};
}

/**
 * @param {{ url?: string, token?: string | null, fetch?: typeof fetch }} [options]
 */
export function createBridgeClient({
	url = DEFAULT_BRIDGE_URL,
	token = null,
	fetch: f = async (input, init) => {
		await transportReady;
		return (transport ?? fetch)(input, init);
	}
} = {}) {
	const base = url.replace(/\/+$/, '');

	/**
	 * @param {string} path @param {RequestInit} [init] @param {boolean} [binary]
	 * @param {string} [name] the catalogue's command this is
	 */
	async function call(path, init = {}, binary = false, name = '') {
		let res;
		try {
			res = await f(`${base}${path}`, {
				...init,
				headers: {
					...(init.body ? { 'Content-Type': 'application/json' } : {}),
					...(token ? { Authorization: `Bearer ${token}` } : {}),
					...(init.headers ?? {})
				},
				cache: 'no-store',
				credentials: 'omit'
			});
		} catch {
			throw await silent('unreachable', 0, null);
		}
		if (binary && res.ok) return new Uint8Array(await res.arrayBuffer());
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			// Sent only because the bridge's node was not connected (sync/remote-bridge.js).
			if (res.status === 503 && body?.code === 'BRIDGE_NODE_UNREACHABLE') {
				throw await silent('nodeUnreachable', 503, body);
			}
			// Refused before it was sent: too large for the bridge's node (sync/remote-bridge.js).
			if (res.status === 413 && body?.code === 'BRIDGE_STREAM_TOO_LARGE') {
				throw failed(t('messages.bridge.streamTooLarge'), 413, body);
			}
			// The bridge answers "not found" for a route it does not have: a command the
			// app's catalogue knows and this bridge not yet – older code than this app.
			if (res.status === 404 && body?.error === 'not found' && name && specOf(name)) {
				throw failed(t('messages.bridge.outdated'), 404, { ...body, code: 'BRIDGE_OUTDATED' });
			}
			const messages = /** @type {Record<number, string>} */ ({
				// Only HTTP answers 401 – the stream knows a device by its proof, and says no
				// with a grant's code: so it is the bridge on this computer, with this token.
				401: t('messages.bridge.unknownDevice'),
				403:
					body?.error === 'origin not allowed'
						? t('messages.bridge.originNotAllowed')
						: t('messages.bridge.wrongCode'),
				// Gone over HTTP since #580: the bridge's node was not reached for it.
				410:
					body?.code === 'HTTP_GONE' ? t('messages.bridge.httpGone') : t('messages.bridge.noCode'),
				503:
					body?.code === 'MAIL_NOT_SET_UP'
						? t('messages.bridge.mailNotSetUp')
						: body?.code === 'LLM_NOT_SET_UP'
							? t('messages.bridge.llmNotSetUp')
							: body?.code === 'PAPERLESS_NOT_SET_UP'
								? t('messages.bridge.paperlessNotSetUp')
								: body?.error
			});
			if (res.status === 402 && body?.code === 'ALEPH_BACKUP_REJECTED') {
				// Aleph refused to keep a backup; with too little credit it says how much is needed.
				const reason = body.reason;
				throw failed(
					reason && Number.isFinite(reason.credits) && Number.isFinite(reason.required)
						? t('messages.bridge.alephNotKept', {
								credits: reason.credits.toLocaleString(intlLocale()),
								required: reason.required.toLocaleString(intlLocale())
							})
						: t('messages.bridge.alephRejected', { error: body?.error ?? '' }),
					402,
					body
				);
			}
			// Paperless behind the bridge (bridge/src/paperless.js): said in the app's language.
			if (PAPERLESS_ERRORS.has(body?.code)) {
				const cause = /\(([A-Z_]+)\)/.exec(String(body?.error ?? ''))?.[1] ?? '';
				throw failed(t(`messages.bridge.paperless.${body.code}`, { cause }), res.status, body);
			}
			if (GRANT_REFUSALS.has(body?.code)) {
				// SCOPE_MISSING names the scope (grants.js): said as the area it is.
				throw failed(
					t(`messages.bridge.grant.${body.code}`, { scope: scopeLabel(body.error) }),
					res.status,
					body
				);
			}
			if (res.status === 403 && body?.code === 'SENDER_UNVERIFIED') {
				throw new BridgeError(t('messages.bridge.senderUnverified'), 403);
			}
			// The provider refused (#417): every further call would be refused the same way.
			if (LLM_REFUSALS.has(body?.code)) {
				// An enclave the bridge looked at itself says why (bridge/src/llm/confidential.js).
				const why =
					body.code === 'LLM_UNREACHABLE' && ENCLAVE_REACH.has(body.reach?.kind)
						? body.reach
						: null;
				throw failed(
					why
						? t(`messages.bridge.enclave.${why.kind}`, {
								provider: providerName(body.provider),
								port: String(why.port ?? '?'),
								code: String(why.code ?? '').slice(0, 24)
							})
						: t(`messages.bridge.refused.${body.code}`, { provider: providerName(body.provider) }),
					res.status,
					body
				);
			}
			if (res.status === 502 && body?.code === 'EXTRACT_FAILED') {
				const reasons = (body.attempts ?? []).map(
					(/** @type {any} */ a) => `${a.model}: ${a.reason}`
				);
				throw new BridgeError(t('messages.bridge.noModel', { reasons: reasons.join('; ') }), 502);
			}
			throw failed(
				messages[res.status] ?? body?.error ?? `Bridge: HTTP ${res.status}`,
				res.status,
				body
			);
		}
		return body;
	}

	/**
	 * One command by its name: its HTTP request from the catalogue, and the
	 * command itself for a transport that calls by name. Arguments the
	 * catalogue's schema would refuse, and the HTTP-only commands, go by path
	 * only (`command` left out), as before #577, so a named call never fails
	 * where the path worked.
	 *
	 * @param {string} name
	 * @param {Record<string, unknown>} [args]
	 * @param {boolean} [binary] the answer is bytes
	 * @param {BodyInit} [bytes] a `bytes` command's body
	 */
	function command(name, args = {}, binary = false, bytes = undefined) {
		const { method, path, body } = httpRequest(name, args);
		// HTTP-only commands (pairing, shares, the upload) never go by name.
		const named = specOf(name)?.via !== 'http' && checkArgs(name, args).length === 0;
		return call(
			path,
			/** @type {RequestInit} */ ({
				method,
				...(bytes !== undefined
					? { body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }
					: body !== null
						? { body }
						: {}),
				...(named ? { command: { name, args } } : {})
			}),
			binary,
			name
		);
	}

	return {
		url: base,
		/** @returns {Promise<{ ok: boolean, paired: boolean, pairingOpen: boolean, hibiscus: { configured: boolean }, mail?: { configured: boolean, accountingAddress: string | null }, llm?: { configured: boolean, models: string[] }, kraken?: { configured: boolean }, paperless?: { configured: boolean }, enablebanking?: { configured: boolean }, backup?: { aleph: boolean }, wallets?: { available: boolean } }>} */
		health: () => command('bridge.health'),
		/**
		 * The bridge node's invitation while it is unarmed (#580): the app on
		 * this machine pairs the node with it over a stream on 127.0.0.1.
		 *
		 * @returns {Promise<string>} `web+ucep:pair?…`
		 */
		nodeInvite: async () => (await command('node.invite')).invitation,
		/**
		 * What a hosted bridge may take over from this bridge (#728): the accounts
		 * it reads and the integrations' settings. Over the stream only, and only
		 * for the device that paired the bridge; over HTTP it is not there.
		 * @returns {Promise<{ config: Record<string, any>, secrets: Record<string, string> }>}
		 */
		settingsExport: () => command('settings.export'),
		/** @param {string} code @returns {Promise<string>} the token */
		async pair(code) {
			const { token } = await command('session.pair', { code });
			return token;
		},
		/** Tells the bridge to forget this device's token. */
		async unpair() {
			await command('session.unpair');
		},
		/** @returns {Promise<BridgeAccount[]>} */
		async accounts() {
			return (await command('bank.accounts')).accounts;
		},
		/**
		 * @param {string} accountId
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<import('../bank/import.js').IncomingTransaction[]>}
		 */
		async transactions(accountId, since) {
			return (await command('bank.transactions', { account: accountId, since })).transactions;
		},
		/**
		 * Mails to the accounting address that arrived in [since, until).
		 *
		 * @param {string} since YYYY-MM-DD
		 * @param {string | null} [until] YYYY-MM-DD, exclusive; null leaves the end open
		 * @returns {Promise<{ accountingAddress: string, messages: any[] }>}
		 */
		async mailMessages(since, until = null) {
			return command('mail.messages', { since, scope: 'accounting', ...(until ? { until } : {}) });
		},
		/**
		 * @param {string} id
		 * @param {string} part
		 * @returns {Promise<Uint8Array>}
		 */
		async mailAttachment(id, part) {
			return /** @type {Promise<Uint8Array>} */ (command('mail.attachment', { id, part }, true));
		},
		/**
		 * One mail as it was received (RFC 822), to keep as the original of a
		 * receipt that is the mail itself (#288). Only a mail to the accounting
		 * address; 404 when it is no longer in the mailbox.
		 *
		 * @param {string} id the mail's id
		 * @returns {Promise<Uint8Array>}
		 */
		async mailRaw(id) {
			return /** @type {Promise<Uint8Array>} */ (command('mail.raw', { id }, true));
		},
		/**
		 * Move one mail to the mailbox's Trash – the bridge's only write to the
		 * mailbox, on a person's confirmed click. Not a delete.
		 *
		 * @param {string} id the mail's id
		 * @returns {Promise<{ trashed: true, trash: string }>}
		 */
		mailTrash: (id) => command('mail.trash', { id }),
		/**
		 * The targeted search in the whole mailbox for one missing receipt: vendor
		 * text and every spelling of an amount, ± days around a day. Only the hits
		 * are read (bridge/README.md).
		 *
		 * @param {{ text?: string | null, amount?: string | null, from?: string[], terms?: string[], around?: string | null, days?: number }} query
		 *   `terms`: more words to find in the whole mail (a crypto payment's hash, address, quantity), at most 6
		 * @returns {Promise<{ messages: any[] }>} each with `matched`: the criteria that hit
		 */
		async mailSearch({
			text = null,
			amount = null,
			from = [],
			terms = [],
			around = null,
			days = 14
		}) {
			return command('mail.search', {
				days,
				...(text ? { text } : {}),
				...(terms.length ? { term: terms.slice(0, 6) } : {}),
				...(amount ? { amount } : {}),
				...(from.length ? { from: from.slice(0, 3).join(',') } : {}),
				...(around ? { around } : {})
			});
		},
		/**
		 * What the bridge reads receipts with: the provider's host, the models,
		 * whether a key is in its keychain (never the key), how many terms it
		 * blacks out, and the mail server id it trusts for the sender check.
		 *
		 * Since the Ollama default (2026-11-16) also whose model it is and where
		 * (`providerInfo`), whether a key is needed, whether Ollama answers and
		 * has the model, and the question about the old DeepSeek default.
		 *
		 * @returns {Promise<{ configured: boolean, provider: string | null, providerInfo?: { id: string, name: string, country: string | null, local: boolean }, models: { primary: string | null, fallback: string | null }, keyConfigured: boolean, keyRequired?: boolean, ollama?: { state: 'running' | 'unreachable' | 'model-missing', model: string } | null, defaultQuestion?: boolean, restartNeeded?: boolean, redactTerms: number, redaction?: { mode: 'auto' | 'on' | 'off', active: boolean }, mail: { authServId: string | null } }>}
		 */
		llmStatus: () => command('llm.status'),
		/**
		 * The answer to the question about the old DeepSeek default: `local`
		 * switches the bridge to Ollama on its computer (after a restart), `keep`
		 * keeps DeepSeek on purpose. The bridge keeps it in its config.
		 *
		 * @param {'local' | 'keep'} answer
		 * @returns {Promise<{ answer: string, restartNeeded: boolean }>}
		 */
		llmChoice: (answer) => command('llm.choice', { answer }),
		/**
		 * What one unit of an asset was worth in EUR on a day, and where that
		 * number comes from (packages/rates/src/rates.js).
		 *
		 * @param {string} asset a symbol from assets/registry.js, e.g. `BTC`
		 * @param {string} date YYYY-MM-DD
		 * @param {{ prefer?: 'kraken', contract?: string, chain?: string, block?: number, decimals?: number }} [options] a Kraken
		 *   booking: Kraken's own EUR price first; a token not in the list: by its contract (#115),
		 *   and with the booking's block and its decimals by its DEX pool there (#163)
		 * @returns {Promise<import('../assets/valuation.js').Rate>}
		 */
		rate: (asset, date, { prefer, contract, chain, block, decimals } = {}) =>
			command('rates.rate', {
				asset,
				date,
				...(prefer ? { prefer } : {}),
				...(contract && chain ? { contract, chain } : {}),
				...(contract && chain && Number.isSafeInteger(block) && Number.isInteger(decimals)
					? { block, decimals }
					: {})
			}),
		/**
		 * What one unit of a listed asset was worth in EUR on each day of a
		 * period, in one call: for a chart. Only the days with a rate; at most a
		 * hundred days. A bridge older than this command answers 404
		 * (`BRIDGE_OUTDATED`): then `rate`, day by day.
		 *
		 * @param {string} asset a symbol from assets/registry.js, e.g. `BTC`
		 * @param {string} from YYYY-MM-DD
		 * @param {string} to YYYY-MM-DD
		 * @returns {Promise<{ asset: string, from: string, to: string, rates: import('../assets/valuation.js').Rate[] }>}
		 */
		rateRange: (asset, from, to) => command('rates.range', { asset, from, to }),
		/**
		 * Enable Banking (issue #224): the banks of a country.
		 *
		 * @param {string} country two letters
		 * @returns {Promise<EnableBankingBank[]>}
		 */
		async enableBankingBanks(country) {
			return (await command('enablebanking.banks', { country })).banks;
		},
		/**
		 * Start a link: the bridge answers with the bank's page and the state it keeps.
		 *
		 * @param {{ bank: string, country: string, psuType?: 'personal' | 'business' }} body
		 * @returns {Promise<{ url: string, state: string, validUntil: string }>}
		 */
		enableBankingLink: (body) => command('enablebanking.link', body),
		/**
		 * Finish a link with the bank's answer.
		 *
		 * @param {{ code: string, state: string }} body
		 * @returns {Promise<EnableBankingLink>}
		 */
		async enableBankingFinish(body) {
			return (await command('enablebanking.finish', body)).link;
		},
		/** @returns {Promise<EnableBankingAccount[]>} every linked account, and whether it may leave the bridge */
		async enableBankingAccounts() {
			return (await command('enablebanking.accounts')).accounts;
		},
		/**
		 * An allowed account's booked transactions from a day on.
		 *
		 * @param {string} uid
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<{ since: string, transactions: import('../bank/import.js').IncomingTransaction[], pending: number, complete: boolean }>}
		 */
		enableBankingTransactions: (uid, since) =>
			command('enablebanking.transactions', { account: uid, since }),
		/** @returns {Promise<EnableBankingLink[]>} */
		async enableBankingLinks() {
			return (await command('enablebanking.links')).links;
		},
		/** @param {string} id */
		async enableBankingUnlink(id) {
			await command('enablebanking.unlink', { id });
		},
		/**
		 * Kraken's non-zero balances (bridge/src/kraken.js).
		 *
		 * @returns {Promise<{ balances: KrakenBalance[] }>}
		 */
		krakenBalances: () => command('kraken.balances'),
		/**
		 * Kraken's ledger from the start of `since` (UTC), oldest first.
		 *
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<{ since: string, entries: KrakenLedgerEntry[], transferRefs?: 'ok' | 'refused' }>}
		 *   `transferRefs`: whether Kraken gave the on-chain hashes of deposits and withdrawals
		 */
		krakenLedgers: (since) => command('kraken.ledgers', { since }),
		/**
		 * What Paperless-ngx added after `since`, with its OCR text (#318).
		 *
		 * @param {string | null} since ISO, or null for everything
		 * @returns {Promise<import('../paperless/import.js').PaperlessDocument[]>}
		 */
		async paperlessDocuments(since) {
			return (await command('paperless.documents', since ? { since } : {})).documents ?? [];
		},
		/**
		 * Paperless' full-text search: at most 25 documents, without their OCR text.
		 *
		 * @param {string} query
		 * @returns {Promise<Omit<import('../paperless/import.js').PaperlessDocument, 'content'>[]>}
		 */
		async paperlessSearch(query) {
			return (await command('paperless.search', { query })).documents ?? [];
		},
		/**
		 * One Paperless document's bytes: the original PDF or image, else its archive PDF.
		 *
		 * @param {number} id
		 * @returns {Promise<Uint8Array>}
		 */
		paperlessDocument: (id) =>
			/** @type {Promise<Uint8Array>} */ (command('paperless.document', { id }, true)),
		/**
		 * The chains an own wallet can be on: endpoints and explorers.
		 *
		 * @returns {Promise<{ chains: ChainInfo[], alchemy?: boolean }>} `alchemy`: whether an
		 *   Alchemy API key is set up in the bridge (never the key)
		 */
		chains: () => command('chains.list'),
		/**
		 * The fingerprint of the Bitcoin key in the bridge's keychain (`btc-…`),
		 * never the key.
		 *
		 * @returns {Promise<{ configured: boolean, fingerprint: string | null }>}
		 */
		bitcoinKey: () => command('chains.bitcoinKey'),
		/**
		 * The relay for own devices in the own network, when the bridge runs one
		 * (bridge/src/lan-relay.js): its WebRTC-Direct address.
		 *
		 * @returns {Promise<{ configured: boolean, running: boolean, addr: string | null }>}
		 */
		lanRelay: () => command('lanRelay.status'),
		/**
		 * An own wallet's whole history and balance, read by the bridge from a
		 * public node (in the body, so the address is in no URL).
		 *
		 * @param {string} chain e.g. `nyx`
		 * @param {{ address: string, endpoints?: Record<string, string>, hashes?: string[] }} body
		 *   `hashes`: exchange withdrawals the indexer is asked for by hash (Akash, #303)
		 * @returns {Promise<WalletHistory>}
		 */
		walletHistory: (chain, body) => command('chains.wallet', { ...body, chain }),
		/**
		 * An Akash wallet's deployments with what each cost (#305), for the
		 * monthly usage statement (in the body, so the address is in no URL).
		 *
		 * @param {{ address: string, endpoints?: Record<string, string> }} body
		 * @returns {Promise<{ deployments: AkashDeployment[], actBalance: string }>}
		 */
		akashDeployments: (body) => command('chains.akashDeployments', body),
		/**
		 * Which of these 0x addresses are Aleph accounts: their credits now and
		 * how many credit entries they ever had (issue #113). Read only.
		 *
		 * @param {string[]} addresses
		 * @param {string} [api] an own Aleph API; Aleph's by default
		 * @returns {Promise<{ address: string, credits: number, entries: number }[]>}
		 */
		alephAccounts: async (addresses, api) =>
			(await command('aleph.accounts', { addresses, ...(api ? { api } : {}) })).accounts,
		/**
		 * One Aleph account's credits in one month: balances, top-ups, consumption
		 * per day and resource, valued in EUR (packages/chains/src/aleph.js).
		 *
		 * @param {string} address
		 * @param {string} month YYYY-MM
		 * @param {string} [api]
		 * @returns {Promise<AlephStatement>}
		 */
		alephStatement: (address, month, api) =>
			command('aleph.statement', { address, month, ...(api ? { api } : {}) }),
		/**
		 * A payer's balance in Filecoin Pay in one month: what it was before and
		 * after, what was paid in and taken out, and each settlement of each
		 * rail, valued in EUR (packages/chains/src/filecoin-pay.js). Read only;
		 * in the body, so the address is in no URL.
		 *
		 * @param {string} address the payer, f410f… or 0x…
		 * @param {string} month YYYY-MM
		 * @param {{ source?: 'index' | 'logs', endpoints?: { index?: string, filfox?: string, blockscout?: string } }} [options]
		 * @returns {Promise<FilecoinPayStatement>}
		 */
		filecoinPayStatement: (address, month, { source, endpoints } = {}) =>
			command('filecoinpay.statement', {
				address,
				month,
				...(source ? { source } : {}),
				...(endpoints ? { endpoints } : {})
			}),
		/**
		 * The backup on Aleph (issue #77): whether `pnpm setup:aleph` has made the
		 * bridge's backup key, the account that pays, its credits, where the app
		 * uploads a backup itself, fetches it back, and signs and lists for itself.
		 *
		 * @returns {Promise<{ aleph: { configured: boolean, address?: string, credits?: number | null, ingestUrl?: string, gateways?: string[], apiHost?: string, putRef?: boolean } }>}
		 */
		backupStatus: () => command('backup.status'),
		/**
		 * Upload a sealed backup through the bridge: it sends the bytes to Aleph
		 * with the STORE signed by its backup key in the same request, so Aleph
		 * keeps them at once. On this computer's bridge only (bytes do not go
		 * over the stream), up to 256 MiB.
		 *
		 * @param {Uint8Array} bytes sealed
		 * @param {string} name letters, digits, dot, dash, underscore
		 * @param {string} [ref] an increment's: its full backup's CID
		 * @returns {Promise<{ cid: string, size: number, address: string, itemHash: string, status: string, ref?: string }>}
		 */
		alephPut: (bytes, name, ref) =>
			command('backup.put', { name, ...(ref ? { ref } : {}) }, false, /** @type {any} */ (bytes)),
		/**
		 * Have Aleph keep a backup the app uploaded to its IPFS host: the bridge
		 * signs the STORE message with its backup key. An increment names the
		 * full backup it builds on (`ref`); an older bridge drops it and
		 * answers without `ref`.
		 *
		 * @param {string} cid
		 * @param {string} [ref]
		 * @param {number} [size] the file's bytes, into the STORE; an older bridge drops it
		 * @returns {Promise<{ cid: string, address: string, itemHash: string, status: string, ref?: string, size?: number }>}
		 */
		alephKeep: (cid, ref, size) =>
			command('backup.keep', {
				cid,
				...(ref ? { ref } : {}),
				...(Number.isInteger(size) ? { size } : {})
			}),
		/**
		 * "Mit KI weitersuchen": the LLM suggests search words and sender domains
		 * from the booking (redacted by the bridge), the bridge searches, and the
		 * LLM picks among the hits' subjects, domains and file names.
		 *
		 * @param {{ counterparty: string, purpose?: string, amount?: string | null, around?: string | null, days?: number, knownDomains?: string[] }} body
		 * @returns {Promise<{ vendor: string | null, terms: string[], domains: string[], messages: any[], pick: { id: string, confidence: 'high' | 'medium' | 'low', reason: string } | null, llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		mailAssist: (body) => command('llm.mail', withTerms(body)),
		/**
		 * "✦ KI-Vorschlag" under "Beleg zuordnen": the LLM picks among receipts,
		 * from their read fields; the bridge redacts.
		 *
		 * @param {{ booking: { counterparty?: string, purpose?: string, amount?: string, day?: string }, candidates: { id: string, vendor?: string, amount?: string, currency?: string, date?: string, number?: string, summary?: string }[] }} body
		 * @returns {Promise<{ pick: { id: string, confidence: 'high' | 'medium' | 'low', reason: string } | null, reason?: string, llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		matchAssist: (body) => command('llm.match', withTerms(body)),
		/**
		 * "✦ KI-Vorschlag" under "Als Gegenbuchung verknüpfen …": the LLM picks
		 * the other side of an own transfer among up to 8 bookings; the bridge
		 * redacts and cuts addresses and hashes.
		 *
		 * @param {{ booking: TransferAssistBooking, candidates: (TransferAssistBooking & { id: string })[] }} body
		 * @returns {Promise<{ pick: { id: string, confidence: 'high' | 'medium' | 'low', reason: string } | null, llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		transferAssist: (body) => command('llm.transfer', withTerms(body)),
		/**
		 * "✦ Ungereimtheiten erklären" on a vendor account (#121): a few notes on
		 * what does not add up; the bridge redacts.
		 *
		 * @param {{ vendor: string, from: string, until: string, opening: string | null, closing: string, rows: any[], findings: string[] }} body
		 * @returns {Promise<{ notes: string[], llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		vendorAssist: (body) => command('llm.vendor', withTerms(body)),
		/**
		 * "✦ Reise prüfen" on a trip (#693 d): up to six notes, each naming the
		 * legs (L1 …) or receipts (R1 …) it is about. Unredacted, so the bridge
		 * answers only with a model on its computer or in the attested enclave;
		 * no company names go along, there is nothing to black out.
		 *
		 * @param {import('$lib/travel/review.js').TripReview} body
		 * @returns {Promise<{ notes: { text: string, refs: string[] }[], llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		travelAssist: (body) => command('llm.travel', /** @type {any} */ (body)),
		/**
		 * "✦ Konto vorschlagen" on a payment's "Konto": up to two accounts of the
		 * chart sent, with a reason; the bridge redacts unless the model is local
		 * or attested.
		 *
		 * @param {{ booking: Record<string, any>, receipt: Record<string, any> | null, learned: { vendor: string, account: string }[], accounts: { number: string, name: string }[] }} body
		 * @returns {Promise<{ picks: { account: string, confidence: 'high' | 'medium' | 'low', reason: string }[], llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		bookingAssist: (body) => command('llm.booking', withTerms(body)),
		/**
		 * A read share for an assistant (issue #124): the snapshot goes to the
		 * bridge, which keeps it in memory and serves it by its id until it expires.
		 *
		 * @param {{ scope: string, redacted: boolean, minutes: number, data: unknown }} body
		 * @returns {Promise<ShareInfo>}
		 */
		createShare: (body) => command('share.create', body),
		/** @returns {Promise<{ shares: ShareInfo[] }>} */
		listShares: () => command('share.list'),
		/** @param {string} id @returns {Promise<{ ok: boolean }>} */
		revokeShare: (id) => command('share.revoke', { id }),
		/**
		 * @param {{ text: string, hints?: Record<string, string>, source?: { mailId: string }, confirmedByUser?: boolean }} body
		 * @returns {Promise<{ extraction: any, model: string, usage: any, ms?: number, attempts: any[], fallback?: { used: boolean, reason: string | null }, redactions?: any, sentText?: string }>}
		 */
		async extract(body) {
			return restoreCompany(await command('llm.extract', withTerms(body)));
		}
	};
}

/** @typedef {ReturnType<typeof createBridgeClient>} BridgeClient */

/**
 * @typedef {object} EnableBankingBank
 * @property {string} name
 * @property {string} country
 * @property {('personal' | 'business')[]} psuTypes
 * @property {number} maxConsentDays
 * @property {boolean} beta
 */

/**
 * @typedef {object} EnableBankingAccount a linked account, as the bridge tells it
 * @property {string} uid
 * @property {string} linkId
 * @property {string} bank
 * @property {string} ibanLast4
 * @property {string} name
 * @property {string} currency
 * @property {string | null} validUntil
 * @property {boolean} allowed whether it may leave the bridge (setup:enablebanking -- --accounts)
 * @property {string | null} ibanKey only for an allowed one: the key the books know the account by
 */

/**
 * @typedef {object} EnableBankingLink a linked bank, as the bridge tells it (no full IBAN)
 * @property {string} id
 * @property {string} bank
 * @property {string} country
 * @property {'personal' | 'business'} psuType
 * @property {string | null} validUntil
 * @property {string} linkedAt
 * @property {{ uid: string, ibanLast4: string, name: string, currency: string }[]} accounts
 */
