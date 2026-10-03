import { t } from '../i18n/index.js';
import { noteWayOut, wayOutKind } from '../help/way-out.js';
// The app's side of the bridge on 127.0.0.1 (see bridge/README.md).

/**
 * @typedef {{ gave: { asset: string, amount: string, listed: boolean }[], got: { asset: string, amount: string, listed: boolean }[], via: string, fee?: { asset: string, amount: string } }} SwapSides
 */

/**
 * @typedef {{ direction?: 'in' | 'out', amount?: string, quantity?: string, asset?: string, day?: string, account?: string, counterparty?: string, purpose?: string }} TransferAssistBooking
 */

/**
 * @typedef {{ id: string, scope: string, redacted: boolean, createdAt: string, expiresAt: string, reads: number }} ShareInfo
 */

export const DEFAULT_BRIDGE_URL = import.meta.env?.VITE_BRIDGE_URL || 'http://127.0.0.1:8765';

export class BridgeError extends Error {
	/** @param {string} message @param {number} status */
	constructor(message, status) {
		super(message);
		this.name = 'BridgeError';
		this.status = status;
	}
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
const withTerms = (body) => JSON.stringify({ ...body, redactTerms: redactTerms().slice(0, 20) });

/**
 * A failed call, with its way out noted for the card that shows the message
 * (help/way-out.js).
 *
 * @param {string} message
 * @param {number} status
 * @param {{ code?: string, error?: string } | null} body
 */
function failed(message, status, body) {
	noteWayOut(message, wayOutKind(status, body));
	return new BridgeError(message, status);
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
 */

/**
 * @typedef {object} WalletEntry what the bridge reads from an own wallet (bridge/src/chains/)
 * @property {string} id stable: Cosmos `<hash>:m<msg>:e<event>.<n>:<asset>`, EVM `<hash>:value` / `:erc20:…` or `:log:<i>` / `:internal:<i>` (Alchemy: `:internal:trace:<address>`); the fee `<hash>:fee`
 * @property {string} hash as the chain gives it
 * @property {number} height
 * @property {string} time ISO 8601
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {'sent' | 'received' | 'fee'} type
 * @property {'transfer' | 'reward' | 'stake' | 'ibc' | 'fee' | 'swap'} kind
 * @property {SwapSides} [swap] EVM: what the wallet gave and got in a swap (issue #115)
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
 * @typedef {object} WalletHistory
 * @property {string} chain
 * @property {Record<string, string>} endpoints the ones asked
 * @property {WalletEntry[]} entries oldest first
 * @property {{ asset: string, amount: string, decimals: number }[]} balances
 * @property {number} transactions
 * @property {number} unknownAssets denoms or tokens that are not booked
 * @property {{ earliestHeight: number, earliestTime: string | null, pruned: boolean, completedBy?: 'indexer', unknownAmounts?: number, indexerFrom?: string | null, indexerError?: string }} history
 *   `completedBy`: a pruned node's older part came from the chain's indexer (Akash, issue #105);
 *   `unknownAmounts`: older transactions whose amount only events carry, not booked
 * @property {string} addressUrl
 * @property {'alchemy' | 'blockscout'} [source] EVM: where it was read
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
 * @typedef {object} AlephStatement bridge/src/aleph.js `statement`
 * @property {string} address
 * @property {string} month YYYY-MM
 * @property {string} from ISO, UTC
 * @property {string} until ISO, UTC
 * @property {number} opening credits
 * @property {number} closing credits
 * @property {{ time: string, credits: number, bonus: number, how: 'purchase' | 'transfer', price: string | null, token: string | null, chain: string | null, txHash: string | null, from: string }[]} topUps
 * @property {{ time: string, credits: number, to: string }[]} transfersOut
 * @property {{ date: string, kind: string, resource: string | null, credits: number, entries: number, resources: number, sizeMib: number | null, usdPerCredit: string, priceSource: 'purchase' | 'list', eurPerUsd: string | null, eurCents: number | null }[]} usage
 * @property {Record<string, { type: string, name: string }>} resources
 * @property {{ topUps: number, transfersOut: number, usage: number, eurCents: number | null }} totals
 * @property {number} difference opening + in − out − closing; 0 when the history is complete
 * @property {string | null} rateSource
 * @property {number} entries
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
 * @param {{ url?: string, token?: string | null, fetch?: typeof fetch }} [options]
 */
export function createBridgeClient({
	url = DEFAULT_BRIDGE_URL,
	token = null,
	fetch: f = (input, init) => (transport ?? fetch)(input, init)
} = {}) {
	const base = url.replace(/\/+$/, '');

	/** @param {string} path @param {RequestInit} [init] @param {boolean} [binary] */
	async function call(path, init = {}, binary = false) {
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
			throw failed(t('messages.bridge.unreachable'), 0, null);
		}
		if (binary && res.ok) return new Uint8Array(await res.arrayBuffer());
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			const messages = /** @type {Record<number, string>} */ ({
				401: t('messages.bridge.unknownDevice'),
				403:
					body?.error === 'origin not allowed'
						? t('messages.bridge.originNotAllowed')
						: t('messages.bridge.wrongCode'),
				410: t('messages.bridge.noCode'),
				503:
					body?.code === 'MAIL_NOT_SET_UP'
						? t('messages.bridge.mailNotSetUp')
						: body?.code === 'LLM_NOT_SET_UP'
							? t('messages.bridge.llmNotSetUp')
							: body?.error
			});
			if (res.status === 403 && body?.code === 'SENDER_UNVERIFIED') {
				throw new BridgeError(t('messages.bridge.senderUnverified'), 403);
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

	return {
		url: base,
		/** @returns {Promise<{ ok: boolean, paired: boolean, pairingOpen: boolean, hibiscus: { configured: boolean }, mail?: { configured: boolean, accountingAddress: string | null }, llm?: { configured: boolean, models: string[] }, kraken?: { configured: boolean }, enablebanking?: { configured: boolean }, backup?: { aleph: boolean }, wallets?: { available: boolean } }>} */
		health: () => call('/health'),
		/** @param {string} code @returns {Promise<string>} the token */
		async pair(code) {
			const { token } = await call('/pair', { method: 'POST', body: JSON.stringify({ code }) });
			return token;
		},
		/** Tells the bridge to forget this device's token. */
		async unpair() {
			await call('/unpair', { method: 'POST' });
		},
		/** @returns {Promise<BridgeAccount[]>} */
		async accounts() {
			return (await call('/hibiscus/accounts')).accounts;
		},
		/**
		 * @param {string} accountId
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<import('../bank/import.js').IncomingTransaction[]>}
		 */
		async transactions(accountId, since) {
			const q = new URLSearchParams({ account: accountId, since });
			return (await call(`/hibiscus/transactions?${q}`)).transactions;
		},
		/**
		 * Mails to the accounting address that arrived in [since, until).
		 *
		 * @param {string} since YYYY-MM-DD
		 * @param {string | null} [until] YYYY-MM-DD, exclusive; null leaves the end open
		 * @returns {Promise<{ accountingAddress: string, messages: any[] }>}
		 */
		async mailMessages(since, until = null) {
			const q = new URLSearchParams({ since, scope: 'accounting' });
			if (until) q.set('until', until);
			return call(`/mail/messages?${q}`);
		},
		/**
		 * @param {string} id
		 * @param {string} part
		 * @returns {Promise<Uint8Array>}
		 */
		async mailAttachment(id, part) {
			const q = new URLSearchParams({ id, part });
			return /** @type {Promise<Uint8Array>} */ (call(`/mail/attachment?${q}`, {}, true));
		},
		/**
		 * Move one mail to the mailbox's Trash – the bridge's only write to the
		 * mailbox, on a person's confirmed click. Not a delete.
		 *
		 * @param {string} id the mail's id
		 * @returns {Promise<{ trashed: true, trash: string }>}
		 */
		mailTrash: (id) =>
			call('/mail/trash', {
				method: 'POST',
				body: JSON.stringify({ id })
			}),
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
			const q = new URLSearchParams({ days: String(days) });
			if (text) q.set('text', text);
			for (const term of terms.slice(0, 6)) q.append('term', term);
			if (amount) q.set('amount', amount);
			if (from.length) q.set('from', from.slice(0, 3).join(','));
			if (around) q.set('around', around);
			return call(`/mail/search?${q}`);
		},
		/**
		 * What the bridge reads receipts with: the provider's host, the models,
		 * whether a key is in its keychain (never the key), how many terms it
		 * blacks out, and the mail server id it trusts for the sender check.
		 *
		 * @returns {Promise<{ configured: boolean, provider: string | null, models: { primary: string | null, fallback: string | null }, keyConfigured: boolean, redactTerms: number, mail: { authServId: string | null } }>}
		 */
		llmStatus: () => call('/llm/status'),
		/**
		 * What one unit of an asset was worth in EUR on a day, and where that
		 * number comes from (bridge/src/rates.js).
		 *
		 * @param {string} asset a symbol from assets/registry.js, e.g. `BTC`
		 * @param {string} date YYYY-MM-DD
		 * @param {{ prefer?: 'kraken', contract?: string, chain?: string, block?: number, decimals?: number }} [options] a Kraken
		 *   booking: Kraken's own EUR price first; a token not in the list: by its contract (#115),
		 *   and with the booking's block and its decimals by its DEX pool there (#163)
		 * @returns {Promise<import('../assets/valuation.js').Rate>}
		 */
		rate: (asset, date, { prefer, contract, chain, block, decimals } = {}) =>
			call(
				`/rates?asset=${encodeURIComponent(asset)}&date=${encodeURIComponent(date)}${prefer ? `&prefer=${prefer}` : ''}${contract && chain ? `&contract=${encodeURIComponent(contract)}&chain=${encodeURIComponent(chain)}` : ''}${contract && chain && Number.isSafeInteger(block) && Number.isInteger(decimals) ? `&block=${block}&decimals=${decimals}` : ''}`
			),
		/**
		 * Kraken's non-zero balances (bridge/src/kraken.js).
		 *
		 * @returns {Promise<{ balances: KrakenBalance[] }>}
		 */
		/**
		 * Enable Banking (issue #224): the banks of a country.
		 *
		 * @param {string} country two letters
		 * @returns {Promise<EnableBankingBank[]>}
		 */
		async enableBankingBanks(country) {
			return (await call(`/enablebanking/banks?country=${encodeURIComponent(country)}`)).banks;
		},
		/**
		 * Start a link: the bridge answers with the bank's page and the state it keeps.
		 *
		 * @param {{ bank: string, country: string, psuType?: 'personal' | 'business' }} body
		 * @returns {Promise<{ url: string, state: string, validUntil: string }>}
		 */
		enableBankingLink: (body) =>
			call('/enablebanking/link', { method: 'POST', body: JSON.stringify(body) }),
		/**
		 * Finish a link with the bank's answer.
		 *
		 * @param {{ code: string, state: string }} body
		 * @returns {Promise<EnableBankingLink>}
		 */
		async enableBankingFinish(body) {
			return (await call('/enablebanking/finish', { method: 'POST', body: JSON.stringify(body) }))
				.link;
		},
		/** @returns {Promise<EnableBankingAccount[]>} every linked account, and whether it may leave the bridge */
		async enableBankingAccounts() {
			return (await call('/enablebanking/accounts')).accounts;
		},
		/**
		 * An allowed account's booked transactions from a day on.
		 *
		 * @param {string} uid
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<{ since: string, transactions: import('../bank/import.js').IncomingTransaction[], pending: number, complete: boolean }>}
		 */
		enableBankingTransactions: (uid, since) =>
			call(`/enablebanking/transactions?${new URLSearchParams({ account: uid, since })}`),
		/** @returns {Promise<EnableBankingLink[]>} */
		async enableBankingLinks() {
			return (await call('/enablebanking/links')).links;
		},
		/** @param {string} id */
		async enableBankingUnlink(id) {
			await call(`/enablebanking/links/${encodeURIComponent(id)}`, { method: 'DELETE' });
		},
		krakenBalances: () => call('/kraken/balances'),
		/**
		 * Kraken's ledger from the start of `since` (UTC), oldest first.
		 *
		 * @param {string} since YYYY-MM-DD
		 * @returns {Promise<{ since: string, entries: KrakenLedgerEntry[], transferRefs?: 'ok' | 'refused' }>}
		 *   `transferRefs`: whether Kraken gave the on-chain hashes of deposits and withdrawals
		 */
		krakenLedgers: (since) => call(`/kraken/ledgers?since=${encodeURIComponent(since)}`),
		/**
		 * The chains an own wallet can be on: endpoints and explorers.
		 *
		 * @returns {Promise<{ chains: ChainInfo[], alchemy?: boolean }>} `alchemy`: whether an
		 *   Alchemy API key is set up in the bridge (never the key)
		 */
		chains: () => call('/chains'),
		/**
		 * The fingerprint of the Bitcoin key in the bridge's keychain (`btc-…`),
		 * never the key.
		 *
		 * @returns {Promise<{ configured: boolean, fingerprint: string | null }>}
		 */
		bitcoinKey: () => call('/bitcoin/key'),
		/**
		 * The relay for own devices in the own network, when the bridge runs one
		 * (bridge/src/lan-relay.js): its WebRTC-Direct address.
		 *
		 * @returns {Promise<{ configured: boolean, running: boolean, addr: string | null }>}
		 */
		lanRelay: () => call('/lan-relay'),
		/**
		 * An own wallet's whole history and balance, read by the bridge from a
		 * public node (in the body, so the address is in no URL).
		 *
		 * @param {string} chain e.g. `nyx`
		 * @param {{ address: string, endpoints?: Record<string, string> }} body
		 * @returns {Promise<WalletHistory>}
		 */
		walletHistory: (chain, body) =>
			call(`/${encodeURIComponent(chain)}/wallet`, { method: 'POST', body: JSON.stringify(body) }),
		/**
		 * Which of these 0x addresses are Aleph accounts: their credits now and
		 * how many credit entries they ever had (issue #113). Read only.
		 *
		 * @param {string[]} addresses
		 * @param {string} [api] an own Aleph API; Aleph's by default
		 * @returns {Promise<{ address: string, credits: number, entries: number }[]>}
		 */
		alephAccounts: async (addresses, api) =>
			(
				await call('/aleph/accounts', {
					method: 'POST',
					body: JSON.stringify({ addresses, ...(api ? { api } : {}) })
				})
			).accounts,
		/**
		 * One Aleph account's credits in one month: balances, top-ups, consumption
		 * per day and resource, valued in EUR (bridge/src/aleph.js).
		 *
		 * @param {string} address
		 * @param {string} month YYYY-MM
		 * @param {string} [api]
		 * @returns {Promise<AlephStatement>}
		 */
		alephStatement: (address, month, api) =>
			call(
				`/aleph/statement?address=${encodeURIComponent(address)}&month=${encodeURIComponent(month)}${api ? `&api=${encodeURIComponent(api)}` : ''}`
			),
		/**
		 * The backup on Aleph (issue #77): whether `pnpm setup:aleph` has made the
		 * bridge's backup key, the account that pays, its credits and where the
		 * app uploads a backup itself.
		 *
		 * @returns {Promise<{ aleph: { configured: boolean, address?: string, credits?: number | null, ingestUrl?: string, gateways?: string[] } }>}
		 */
		backupStatus: () => call('/backup/status'),
		/**
		 * The backups the bridge's Aleph account had kept, newest first.
		 *
		 * @returns {Promise<{ backups: { cid: string, at: string, itemHash: string }[] }>}
		 */
		backupList: () => call('/backup/aleph/list'),
		/**
		 * Have Aleph keep a backup the app uploaded to its IPFS host: the bridge
		 * signs the STORE message with its backup key.
		 *
		 * @param {string} cid
		 * @returns {Promise<{ cid: string, address: string, itemHash: string, status: string }>}
		 */
		alephKeep: (cid) =>
			call('/backup/aleph/pin', { method: 'POST', body: JSON.stringify({ cid }) }),
		/**
		 * "Mit KI weitersuchen": the LLM suggests search words and sender domains
		 * from the booking (redacted by the bridge), the bridge searches, and the
		 * LLM picks among the hits' subjects, domains and file names.
		 *
		 * @param {{ counterparty: string, purpose?: string, amount?: string | null, around?: string | null, days?: number, knownDomains?: string[] }} body
		 * @returns {Promise<{ vendor: string | null, terms: string[], domains: string[], messages: any[], pick: { id: string, confidence: 'high' | 'medium' | 'low', reason: string } | null, llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		mailAssist: (body) => call('/mail/assist', { method: 'POST', body: withTerms(body) }),
		/**
		 * "✦ KI-Vorschlag" under "Beleg zuordnen": the LLM picks among receipts,
		 * from their read fields; the bridge redacts.
		 *
		 * @param {{ booking: { counterparty?: string, purpose?: string, amount?: string, day?: string }, candidates: { id: string, vendor?: string, amount?: string, currency?: string, date?: string, number?: string, summary?: string }[] }} body
		 * @returns {Promise<{ pick: { id: string, confidence: 'high' | 'medium' | 'low', reason: string } | null, reason?: string, llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		matchAssist: (body) => call('/match/assist', { method: 'POST', body: withTerms(body) }),
		/**
		 * "✦ KI-Vorschlag" under "Als Gegenbuchung verknüpfen …": the LLM picks
		 * the other side of an own transfer among up to 8 bookings; the bridge
		 * redacts and cuts addresses and hashes.
		 *
		 * @param {{ booking: TransferAssistBooking, candidates: (TransferAssistBooking & { id: string })[] }} body
		 * @returns {Promise<{ pick: { id: string, confidence: 'high' | 'medium' | 'low', reason: string } | null, llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		transferAssist: (body) => call('/transfer/assist', { method: 'POST', body: withTerms(body) }),
		/**
		 * "✦ Ungereimtheiten erklären" on a vendor account (#121): a few notes on
		 * what does not add up; the bridge redacts.
		 *
		 * @param {{ vendor: string, from: string, until: string, opening: string | null, closing: string, rows: any[], findings: string[] }} body
		 * @returns {Promise<{ notes: string[], llm: { calls: { model: string, ms: number, usage: any }[], sent: string[] } }>}
		 */
		vendorAssist: (body) => call('/vendor/assist', { method: 'POST', body: withTerms(body) }),
		/**
		 * A read share for an assistant (issue #124): the snapshot goes to the
		 * bridge, which keeps it in memory and serves it by its id until it expires.
		 *
		 * @param {{ scope: string, redacted: boolean, minutes: number, data: unknown }} body
		 * @returns {Promise<ShareInfo>}
		 */
		createShare: (body) => call('/share', { method: 'POST', body: JSON.stringify(body) }),
		/** @returns {Promise<{ shares: ShareInfo[] }>} */
		listShares: () => call('/share'),
		/** @param {string} id @returns {Promise<{ ok: boolean }>} */
		revokeShare: (id) => call(`/share/${encodeURIComponent(id)}`, { method: 'DELETE' }),
		/**
		 * @param {{ text: string, hints?: Record<string, string>, source?: { mailId: string }, confirmedByUser?: boolean }} body
		 * @returns {Promise<{ extraction: any, model: string, usage: any, ms?: number, attempts: any[], fallback?: { used: boolean, reason: string | null }, redactions?: any, sentText?: string }>}
		 */
		async extract(body) {
			return restoreCompany(await call('/extract', { method: 'POST', body: withTerms(body) }));
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
