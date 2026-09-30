// Transactions that need no receipt. Pure; configurable through the
// "Eigene Anweisungen" (settings key `matching`).
//
// In this order:
//   1. the person's own rules: counterparty or purpose contains a text →
//      ignore (with the reason given) or private
//   2. bank fees: booking type Abschluss, Entgelt, Mehrwertsteuerbelastung –
//      the account statement is the receipt
//   3. own transfers: the counterparty IBAN is one of our own accounts (or ends
//      like one and that account shows the counter-booking), or the
//      counterparty is our own company – neutral account 1360, no receipt
//   4. loans: "Darlehen" in the purpose – the contract is the receipt
// An exchange's own bookings (exchanges/kraken-sync.js) come with a
// `movement`: its fees are fees, its staking and earn rewards need no receipt
// (the statement is the receipt), and the two legs of one trade or transfer
// share a reference (`txRef`) and are an own transfer.
// An own wallet's bookings (wallets/wallet-sync.js) come with the other
// side's address: when that address is one of our own wallets, the transfer
// is an own transfer; the two legs of one transaction between our wallets
// share the hash as `txRef`. Tokens delegated to staking (movement `stake`)
// stay ours: no receipt, a kind of their own (`crypto-stake`), not 1360.
// Dust – an incoming transfer worth less than a cent – needs no receipt
// (`crypto-dust`); when its sender's address looks like one the person deals
// with, it is likely address poisoning, and the classification names that one.
// (docs/phase-0.md, "Matching"; docs/crypto.md, "Own wallets").

import { mutualTwin } from './twins.js';
import { cleanPrepaidVendors } from './vendor-account.js';
import { counterpartyKey } from './partners.js';
import { compactIban, normalizeRef } from './normalize.js';
import { cosmosChainOf, normalizeAddress, walletChain } from '../wallets/chains.js';
import { isDust } from './dust.js';
import { t } from '../i18n/index.js';

/** Legal forms dropped before two company names are compared. */
const LEGAL_FORMS = new Set([
	'gmbh',
	'mbh',
	'ag',
	'se',
	'ug',
	'kg',
	'ohg',
	'gbr',
	'eg',
	'ev',
	'co',
	'haftungsbeschrankt',
	'haftungsbeschraenkt',
	'ltd',
	'inc',
	'llc'
]);

/** @param {unknown} s */
function nameWords(s) {
	return String(s ?? '')
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.split(/[^a-z0-9]+/)
		.filter((w) => w && !LEGAL_FORMS.has(w));
}

/**
 * Whether `name` names our company `company`: the company's words (legal form
 * dropped), in order, inside the name. "LE SPACE UG (HAFTUNGSBESCHRAENKT)"
 * and "Le Space" are "le space UG"; "Space Cafe GmbH" is not.
 *
 * @param {unknown} name
 * @param {unknown} company
 */
export function isOwnName(name, company) {
	const needle = nameWords(company);
	const hay = nameWords(name);
	if (!needle.length || normalizeRef(needle.join('')).length < 4) return false;
	for (let i = 0; i + needle.length <= hay.length; i++) {
		if (needle.every((w, j) => hay[i + j] === w)) return true;
	}
	return false;
}

/**
 * @typedef {object} Rule a person's own instruction
 * @property {string} id
 * @property {'counterparty' | 'purpose' | 'any'} field
 * @property {string} contains
 * @property {'ignore' | 'private'} action
 * @property {string} [reason]
 */

/**
 * @typedef {object} MatchingSettings stored under the settings key `matching`
 * @property {string[]} companyNames
 * @property {string[]} ownIbans full IBANs the person typed in
 * @property {Rule[]} rules
 * @property {number} graceDays a booking without a receipt is asked about only once it is older than this (0: at once)
 * @property {string[]} feeKeys bookings a person called a bank fee (`feeKey`)
 * @property {string[]} notTransfers pairs of booking ids a person said are no transfer (`transferPairKey`)
 * @property {string[]} ownTransfers pairs a person linked as the two sides of an own transfer (`transferPairKey`)
 * @property {string[]} ownSwaps pairs a person linked as the two sides of a swap (`transferPairKey`, issue #170)
 * @property {string[]} migrations a token burned by its project and its replacement, linked by a person (`transferPairKey`, issue #162)
 * @property {string[]} refundPairs `refundPairKey`: a charge and its refund a person linked (refunds.js)
 * @property {string[]} notRefunds pairs a person said are no refund
 * @property {{ name: string, openings: Record<string, number> }[]} prepaidVendors vendors a person keeps as a prepaid account, with opening balances per year (vendor-account.js)
 * @property {string[]} keptTransferReceipts `<transaction id>|<receipt id>`: an own transfer whose receipt a person said is right
 */

/** A receipt often arrives days after the debit: no question before then. */
export const DEFAULT_GRACE_DAYS = 7;
export const MAX_GRACE_DAYS = 90;

/** @returns {MatchingSettings} */
export function defaultMatchingSettings() {
	return {
		companyNames: [],
		ownIbans: [],
		rules: [],
		graceDays: DEFAULT_GRACE_DAYS,
		feeKeys: [],
		notTransfers: [],
		ownTransfers: [],
		ownSwaps: [],
		migrations: [],
		refundPairs: [],
		notRefunds: [],
		prepaidVendors: [],
		keptTransferReceipts: []
	};
}

/** @param {unknown} v @returns {number} */
function graceDaysOf(v) {
	const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
	return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_GRACE_DAYS
		? n
		: DEFAULT_GRACE_DAYS;
}

/**
 * A stored value, cleaned: unknown fields dropped, bad entries left out.
 *
 * @param {any} value
 * @returns {MatchingSettings}
 */
export function cleanMatchingSettings(value) {
	const strings = (/** @type {unknown} */ v) =>
		Array.isArray(v) ? v.map((s) => String(s ?? '').trim()).filter(Boolean) : [];
	const rules = Array.isArray(value?.rules) ? value.rules : [];
	return {
		companyNames: strings(value?.companyNames),
		ownIbans: strings(value?.ownIbans)
			.map((s) => compactIban(s))
			.filter(Boolean),
		rules: rules
			.filter(
				(/** @type {any} */ r) =>
					r &&
					typeof r.contains === 'string' &&
					r.contains.trim().length >= 2 &&
					(r.action === 'ignore' || r.action === 'private')
			)
			.map((/** @type {any} */ r) => ({
				id: String(r.id ?? r.contains),
				field: r.field === 'purpose' || r.field === 'any' ? r.field : 'counterparty',
				contains: r.contains.trim(),
				action: r.action,
				reason: typeof r.reason === 'string' ? r.reason.trim() : ''
			})),
		graceDays: graceDaysOf(value?.graceDays),
		// Bookings a person called a bank fee (feeKey below): the next like it is one too.
		feeKeys: [...new Set(strings(value?.feeKeys))].slice(-200),
		// Counter-bookings a person said were no transfer (transferPairKey).
		notTransfers: [...new Set(strings(value?.notTransfers))].slice(-200),
		// Two bookings a person linked as one own transfer (issue #98): kept
		// through every run, whatever the rules find.
		ownTransfers: [...new Set(strings(value?.ownTransfers))].slice(-500),
		ownSwaps: [...new Set(strings(value?.ownSwaps))].slice(-500),
		migrations: [...new Set(strings(value?.migrations))].slice(-500),
		// A charge and its refund, linked by hand, and pairs kept apart (refunds.js).
		refundPairs: [...new Set(strings(value?.refundPairs))].slice(-500),
		notRefunds: [...new Set(strings(value?.notRefunds))].slice(-500),
		prepaidVendors: cleanPrepaidVendors(value?.prepaidVendors),
		// An own transfer that keeps its receipt on purpose (Home, "Beleg ist richtig").
		keptTransferReceipts: [...new Set(strings(value?.keptTransferReceipts))].slice(-500)
	};
}

/**
 * Two bookings as one key, whichever comes first.
 *
 * @param {string} a
 * @param {string} b
 */
export function transferPairKey(a, b) {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * What makes two bank fees "the same" for learning: the account and the
 * purpose's words, without digits (dates and numbers change every month).
 *
 * @param {Record<string, any>} tx
 * @returns {string} '' when the purpose has no words to go by
 */
export function feeKey(tx) {
	const words = counterpartyKey(tx.purpose);
	return words ? `${tx.accountId ?? ''}|${words}` : '';
}

/**
 * @typedef {object} ClassifyContext
 * @property {string[]} companyNames
 * @property {Set<string>} ownIbans compact IBANs: typed in, or resolved from the accounts
 * @property {Map<string, string[]>} ownLast4 last four digits → ids of our accounts whose full IBAN we do not keep (Hibiscus hands out only those)
 * @property {(tx: Record<string, any>, accountIds: string[]) => boolean} [mirrored] whether one of those accounts booked the same amount the other way within a few days
 * @property {Rule[]} rules
 * @property {number} [graceDays] see grace.js
 * @property {Set<string>} [feeKeys] learned bank fees (feeKey)
 * @property {(tx: Record<string, any>) => Record<string, any>[]} [counterBookings] bookings on our other accounts with the opposite amount within a few days
 * @property {(tx: Record<string, any>) => Record<string, any>[]} [sameReference] bookings on our other accounts with the same reference or transaction hash, the other way (context.js)
 * @property {Set<string>} [notTransfers] pairs a person said are no transfer (transferPairKey)
 * @property {(tx: Record<string, any>) => { other: Record<string, any>, role: 'charge' | 'refund', full: boolean, manual: boolean } | null} [refundOf] a charge's refund or a refund's charge (refunds.js)
 * @property {(r: Record<string, any>) => boolean} [prepaidReceipt] a statement of a confirmed prepaid vendor: covered by its account
 * @property {(tx: Record<string, any>) => string | null} [prepaidVendorOf] the confirmed prepaid vendor a payment tops up (vendor-account.js)
 * @property {(tx: Record<string, any>) => Record<string, any> | null} [linkedTransfer] the booking a person linked as this one's other side (context.js)
 * @property {(tx: Record<string, any>) => Record<string, any>[]} [bridgeCounterparts] the other side of a bridge transfer on another own wallet (context.js)
 * @property {(tx: Record<string, any>) => Record<string, any> | null} [ibanCounterpart] the other side of an own transfer by IBAN, on the account that IBAN names (context.js, #176)
 * @property {(tx: Record<string, any>) => boolean} [ibanCounterpartMissing] that account is in the books, and no booking there fits
 * @property {(tx: Record<string, any>) => Record<string, any> | null} [linkedMigration] a burned token's replacement, or the burn a replacement is for (#162)
 * @property {(tx: Record<string, any>) => Record<string, any> | null} [linkedSwap] the booking a person linked as this one's other side of a swap (context.js)
 * @property {(tx: Record<string, any>) => import('./context.js').CrossSwapSide | null} [crossSwapOf] a swap across chains this booking is a side of (context.js, issue #170)
 * @property {Map<string, Map<string, string>>} [ownAddresses] `<chain>:<address>` (normalised) of our own wallets → their accounts by asset ('' = the first)
 * @property {(tx: Record<string, any>) => string | null} [lookalikeOf] a known address the booking's other side looks like, but is not
 */

/**
 * @typedef {object} Classification
 * @property {'rule-ignore' | 'rule-private' | 'bank-fee' | 'own-transfer' | 'loan' | 'crypto-reward' | 'crypto-stake' | 'crypto-dust' | 'crypto-swap' | 'token-burn' | 'token-migration' | 'refund' | 'prepaid-topup'} kind
 *   `token-burn`: tokens burned in the token project's transaction, not the person's (#162);
 *   `token-migration`: such a burn and its replacement, linked by a person
 *   `crypto-dust`: an incoming wallet transfer worth less than a cent
 *   `crypto-stake`: tokens delegated to staking (or back); no receipt, and not
 *   on 1360: the return at the end of an unbonding is no transaction, so a
 *   transit account would never balance
 * @property {string} [reason] the person's own words, for a rule
 * @property {string} [account] SKR 03 account, where one is known
 * @property {string} [ruleId]
 * @property {'counterparty' | 'purpose' | 'any'} [ruleField] what the rule looked at
 * @property {string} [ruleContains] the rule's text
 * @property {'iban' | 'mirrored' | 'company' | 'counter-booking' | 'reference' | 'own-address' | 'bridge' | 'cross-chain' | 'manual' | 'booking-type' | 'bank-code' | 'fee-words' | 'learned' | 'exchange-fee' | 'network-fee'} [via] how an own transfer or a bank fee was recognised
 * @property {string} [address] our own wallet's address, for via 'own-address'
 * @property {string} [vendor] the prepaid vendor, for kind 'prepaid-topup'
 * @property {'charge' | 'refund' | 'send' | 'arrival'} [role] which side this is: of a refund pair, or of a swap across chains
 * @property {string} [chain] the other wallet's chain: an IBC receiver's (via 'own-address'), a bridge's other side (via 'bridge')
 * @property {string} [lookalike] for dust: the known address its sender's looks like
 * @property {string} [receiver] for a swap across chains: where its result goes
 * @property {boolean} [targetMissing] for a swap across chains: the receiver is ours, but not in the books
 * @property {number} [candidates] for a swap across chains: how many arrivals fit
 * @property {string} [counterBookingId] the other side of a transfer, for via 'counter-booking'
 * @property {string} [counterAccountId]
 * @property {string} [counterDay] YYYY-MM-DD
 * @property {string} [sign] what besides the amount says transfer: a word from the purpose, or our company name
 * @property {string} [ibanLast4] the counterparty account's last four, for an own transfer by IBAN
 * @property {boolean} [counterMissing] an own transfer by IBAN whose account is in the books, but no booking there fits
 * @property {string} [company] our company name the counterparty matched
 * @property {string} [bookingType] for a bank fee
 * @property {string} [bankCode] for a bank fee by its ISO 20022 code
 * @property {string} [feeWord] for a bank fee by the words of its purpose
 */

// `FEE`: the kind of a Wise entry's code (bank/camt.js, issue #218).
const BANK_FEE = /abschluss|entgelt|mehrwertsteuerbelast|kontof(?:u|ü)hrung|^fee$/i;
/** ISO 20022 families and sub-families that mean a charge (BkTxCd, CAMT). */
const FEE_CODES = new Set(['CHRG', 'FEES', 'COMM']);
/** A fee in the purpose, when no one but the bank is on the other side. */
const FEE_WORDS =
	/geb(?:ü|ue)hr|entgelt|kontof(?:ü|ue|u)hrung|\bfees?\b|\bcharges?\b|\bplan fee\b|\bsubscription fee\b/i;
/** A counterparty that is a bank, not a vendor. */
const BANK_NAME =
	/\bbank\b|gemeinschaftsbank|revolut|sparkasse|volksbank|raiffeisen|\bgls\b|\bn26\b|qonto|commerzbank|postbank/i;
const LOAN = /darlehen/i;
/** A purpose or name that says money moves between one's own accounts. */
const TRANSFER_WORDS =
	/umbuchung|übertrag|uebertrag|\btransfer\b|top.?up|aufladung|einzahlung|eigenes konto|own account/i;

/**
 * What besides the amount says a booking is a transfer: a transfer word in
 * its purpose or counterparty, or our company as counterparty.
 *
 * @param {Record<string, any>} tx
 * @param {string[]} companyNames
 * @returns {string | null}
 */
function transferSign(tx, companyNames) {
	// A deposit or withdrawal of euros on an exchange: money from or to a bank.
	if (tx.source === 'kraken' && tx.movement === 'transfer' && !tx.quantity) return 'Kraken';
	const text = `${tx.purpose ?? ''} ${tx.counterparty ?? ''}`;
	const word = TRANSFER_WORDS.exec(text)?.[0];
	if (word) return word;
	return companyNames.find((c) => isOwnName(String(tx.counterparty ?? ''), c)) ?? null;
}

/**
 * What the other side says: its counterparty account is this booking's
 * account (a full IBAN we know, or the last four digits of this account).
 * The same name on both sides is no sign on its own: a vendor who refunds
 * to the other account looks alike (see `ownNameCandidate` in view.js).
 *
 * @param {Record<string, any>} tx
 * @param {Record<string, any>} other
 * @param {ClassifyContext} ctx
 * @returns {string | null}
 */
function pairSign(tx, other, ctx) {
	const iban = compactIban(other.counterpartyIban);
	if (iban && ctx.ownIbans.has(iban)) return t('messages.classify.ownAccount');
	if (iban && (ctx.ownLast4.get(iban.slice(-4)) ?? []).includes(String(tx.accountId))) {
		return t('messages.classify.ownAccount');
	}
	return null;
}

/**
 * The bookings that could be this one's other side as an own transfer: the
 * same amount the other way on another account within days, not refused by
 * the person, and with a word or name that says transfer.
 *
 * @param {Record<string, any>} tx
 * @param {ClassifyContext} ctx
 * @returns {{ o: Record<string, any>, sign: string }[]}
 */
function signedCounterBookings(tx, ctx) {
	return (ctx.counterBookings?.(tx) ?? [])
		.filter((o) => !ctx.notTransfers?.has(transferPairKey(String(tx.id), String(o.id))))
		.map((o) => ({
			o,
			sign:
				transferSign(tx, ctx.companyNames) ??
				transferSign(o, ctx.companyNames) ??
				pairSign(tx, o, ctx)
		}))
		.filter((x) => Boolean(x.sign))
		.map((x) => /** @type {{ o: Record<string, any>, sign: string }} */ (x));
}

/** The zero address and the usual "dead" one, where tokens are destroyed. @param {unknown} a */
const isBurnTarget = (a) =>
	[`0x${'0'.repeat(40)}`, `0x${'0'.repeat(36)}dead`].includes(String(a ?? '').toLowerCase());

/**
 * Whether a transaction needs no receipt, and why; null when it needs one.
 *
 * @param {Record<string, any>} tx a transactions record
 * @param {ClassifyContext} ctx
 * @returns {Classification | null}
 */
export function classifyTransaction(tx, ctx) {
	const counterparty = String(tx.counterparty ?? '');
	const purpose = String(tx.purpose ?? '');
	for (const rule of ctx.rules) {
		const needle = rule.contains.toLowerCase();
		const inName = counterparty.toLowerCase().includes(needle);
		const inPurpose = purpose.toLowerCase().includes(needle);
		const hit =
			rule.field === 'counterparty'
				? inName
				: rule.field === 'purpose'
					? inPurpose
					: inName || inPurpose;
		if (hit) {
			return {
				kind: rule.action === 'private' ? 'rule-private' : 'rule-ignore',
				reason: rule.reason || rule.contains,
				ruleId: rule.id,
				ruleField: rule.field,
				ruleContains: rule.contains
			};
		}
	}
	// Linked by hand as the two sides of an own transfer: that holds.
	const linked = ctx.linkedTransfer?.(tx);
	if (linked) {
		return {
			kind: 'own-transfer',
			account: '1360',
			via: 'manual',
			counterBookingId: String(linked.id),
			counterAccountId: String(linked.accountId ?? ''),
			counterDay: String(linked.bookedOn ?? '')
		};
	}
	// A token burned by its project and its replacement, linked by a person (#162).
	const migrated = ctx.linkedMigration?.(tx);
	if (migrated) {
		return {
			kind: 'token-migration',
			via: 'manual',
			counterBookingId: String(migrated.id),
			counterAccountId: String(migrated.accountId ?? ''),
			counterDay: String(migrated.bookedOn ?? '')
		};
	}
	// Burned in the project's transaction, not the person's: no payment to anyone.
	if (tx.movedByOther && Number(tx.amountCents ?? 0) <= 0 && isBurnTarget(tx.counterpartyAddress)) {
		return { kind: 'token-burn' };
	}
	// Linked by hand as the two sides of a swap (issue #170).
	const swappedWith = ctx.linkedSwap?.(tx);
	if (swappedWith) {
		return {
			kind: 'crypto-swap',
			via: 'manual',
			counterBookingId: String(swappedWith.id),
			counterAccountId: String(swappedWith.accountId ?? ''),
			counterDay: String(swappedWith.bookedOn ?? '')
		};
	}
	// A swap across chains planned in an IBC memo, its result to an own wallet
	// (issue #170): a swap, not a payment; paired with its arrival where one fits.
	const cross = ctx.crossSwapOf?.(tx);
	if (cross) {
		return {
			kind: 'crypto-swap',
			via: 'cross-chain',
			role: cross.role,
			chain: cross.chain,
			receiver: cross.receiver,
			candidates: cross.candidates,
			...(cross.targetMissing ? { targetMissing: true } : {}),
			...(cross.other
				? {
						counterBookingId: String(cross.other.id),
						counterAccountId: String(cross.other.accountId ?? ''),
						counterDay: String(cross.other.bookedOn ?? '')
					}
				: {})
		};
	}
	// A charge and its refund (refunds.js): a full refund covers both; a
	// partial one covers the refund, and the charge still needs its receipt.
	const refund = ctx.refundOf?.(tx);
	if (refund && (refund.full || refund.role === 'refund')) {
		return {
			kind: 'refund',
			role: refund.role,
			via: refund.manual ? 'manual' : 'counter-booking',
			counterBookingId: String(refund.other.id),
			counterAccountId: String(refund.other.accountId ?? ''),
			counterDay: String(refund.other.bookedOn ?? '')
		};
	}
	// A top-up of a prepaid account the person keeps (vendor-account.js): the
	// vendor's statements of what the credit was used for are its receipts.
	const prepaid = ctx.prepaidVendorOf?.(tx);
	if (prepaid) return { kind: 'prepaid-topup', vendor: prepaid };
	const wallet = walletChain(tx.source);
	if (tx.movement === 'fee') {
		return { kind: 'bank-fee', via: wallet ? 'network-fee' : 'exchange-fee' };
	}
	if (tx.movement === 'reward') return { kind: 'crypto-reward' };
	if (wallet && tx.movement === 'stake') return { kind: 'crypto-stake' };
	if (BANK_FEE.test(String(tx.bookingType ?? ''))) {
		return { kind: 'bank-fee', via: 'booking-type', bookingType: String(tx.bookingType) };
	}
	const code = String(tx.bankCode ?? '');
	if (code && code.split('/').some((c) => FEE_CODES.has(c.toUpperCase()))) {
		return { kind: 'bank-fee', via: 'bank-code', bankCode: code };
	}
	const key = feeKey(tx);
	if (key && ctx.feeKeys?.has(key)) return { kind: 'bank-fee', via: 'learned' };
	const onlyBank = !counterparty.trim() || BANK_NAME.test(counterparty);
	const word = Number(tx.amountCents ?? 0) < 0 && onlyBank ? FEE_WORDS.exec(purpose)?.[0] : null;
	if (word) return { kind: 'bank-fee', via: 'fee-words', feeWord: word };
	const iban = compactIban(tx.counterpartyIban);
	if (iban && ctx.ownIbans.has(iban)) {
		// Its other side on that account, where the books have it (issue #176).
		const other = ctx.ibanCounterpart?.(tx);
		return {
			kind: 'own-transfer',
			account: '1360',
			via: 'iban',
			ibanLast4: iban.slice(-4),
			...(other
				? {
						counterBookingId: String(other.id),
						counterAccountId: String(other.accountId ?? ''),
						counterDay: String(other.bookedOn ?? '')
					}
				: ctx.ibanCounterpartMissing?.(tx)
					? { counterMissing: true }
					: {})
		};
	}
	// The other side of an own transfer that names this account's IBAN – the
	// receiving bank often gives no IBAN of the sender (issue #176).
	const byIban = ctx.ibanCounterpart?.(tx);
	if (byIban && !ctx.notTransfers?.has(transferPairKey(String(tx.id), String(byIban.id)))) {
		return {
			kind: 'own-transfer',
			account: '1360',
			via: 'counter-booking',
			counterBookingId: String(byIban.id),
			counterAccountId: String(byIban.accountId ?? ''),
			counterDay: String(byIban.bookedOn ?? ''),
			sign: t('messages.classify.ibanOnOtherSide')
		};
	}
	// Four digits alone match a vendor's IBAN one time in 10 000: only with the
	// counter-booking on that account.
	const last4 = iban ? ctx.ownLast4.get(iban.slice(-4)) : undefined;
	if (last4?.length && ctx.mirrored?.(tx, last4)) {
		return { kind: 'own-transfer', account: '1360', via: 'mirrored', ibanLast4: iban.slice(-4) };
	}
	// The other side on one of our accounts: the same amount the other way within
	// a few days, and a word or name that says transfer on either side. Exactly
	// one such booking, or none is taken: two 200,00 in one week are a question.
	const unpaired = (/** @type {Record<string, any>} */ o) =>
		!ctx.notTransfers?.has(transferPairKey(String(tx.id), String(o.id)));
	// A swap on a DEX (issue #115): one asset given, another got, in one
	// transaction. The transaction in the block explorer is the receipt; the
	// legs, where both are booked, relate as Tausch by their hash.
	if (wallet && tx.movement === 'trade') return { kind: 'crypto-swap' };
	// The other side by reference, whatever the euro amounts: the other leg of a
	// trade (same refid), or the wallet that received a withdrawal (same hash).
	const sameRef = (ctx.sameReference?.(tx) ?? []).filter(unpaired);
	if (sameRef.length === 1) {
		const [o] = sameRef;
		return {
			kind: 'own-transfer',
			account: '1360',
			via: 'reference',
			counterBookingId: String(o.id),
			counterAccountId: String(o.accountId ?? ''),
			counterDay: String(o.bookedOn ?? ''),
			sign:
				tx.txRef && o.txRef && tx.txRef === o.txRef
					? `Ref. ${tx.txRef}`
					: 'gleicher Transaktions-Hash'
		};
	}
	// To or from one of our own wallets.
	const address =
		wallet && tx.counterpartyAddress ? normalizeAddress(wallet, tx.counterpartyAddress) : '';
	// By chain and address: an EVM address is the same on every EVM chain, and
	// being ours on Base says nothing about Ethereum.
	// The other side's account of the same asset: USDC goes to the USDC account.
	// An IBC transfer names its receiver on the other chain: looked up there,
	// by the address's bech32 prefix (issue #98).
	const ibc =
		wallet?.kind === 'cosmos' && tx.counterpartyAddress
			? cosmosChainOf(String(tx.counterpartyAddress))
			: null;
	const lookupChain = ibc && ibc.id !== tx.source ? ibc : null;
	const own = address
		? ctx.ownAddresses?.get(
				lookupChain
					? `${lookupChain.id}:${normalizeAddress(lookupChain, String(tx.counterpartyAddress))}`
					: `${tx.source}:${address}`
			)
		: undefined;
	const ownAccount = own ? (own.get(String(tx.asset ?? '')) ?? own.get('')) : undefined;
	if (ownAccount && ownAccount !== tx.accountId) {
		return {
			kind: 'own-transfer',
			account: '1360',
			via: 'own-address',
			address,
			counterAccountId: ownAccount,
			...(lookupChain ? { chain: lookupChain.id } : {})
		};
	}
	// Over a bridge to or from another own wallet: the same asset, the
	// quantity less the bridge's fee, within days (context.js bridgeCounterparts).
	const bridged = (ctx.bridgeCounterparts?.(tx) ?? []).filter(unpaired);
	if (bridged.length === 1) {
		const [o] = bridged;
		return {
			kind: 'own-transfer',
			account: '1360',
			via: 'bridge',
			counterBookingId: String(o.id),
			counterAccountId: String(o.accountId ?? ''),
			counterDay: String(o.bookedOn ?? ''),
			chain: String(o.source ?? '')
		};
	}
	if (isDust(tx)) {
		const lookalike = ctx.lookalikeOf?.(tx);
		return { kind: 'crypto-dust', ...(lookalike ? { lookalike } : {}) };
	}
	const signed = signedCounterBookings(tx, ctx);
	// Twins (issue #176): two of the same amount each way – told apart by
	// purpose, then date, when both sides pick each other.
	const twin =
		signed.length > 1
			? mutualTwin(
					tx,
					signed.map((x) => x.o),
					(o) => signedCounterBookings(o, ctx).map((x) => x.o)
				)
			: null;
	if (signed.length === 1 || twin) {
		const { o, sign } = twin
			? /** @type {{ o: Record<string, any>, sign: string }} */ (
					signed.find((x) => x.o.id === twin.id)
				)
			: signed[0];
		return {
			kind: 'own-transfer',
			account: '1360',
			via: 'counter-booking',
			counterBookingId: String(o.id),
			counterAccountId: String(o.accountId ?? ''),
			counterDay: String(o.bookedOn ?? ''),
			sign: /** @type {string} */ (sign)
		};
	}
	const company = ctx.companyNames.find((c) => isOwnName(counterparty, c));
	if (company) return { kind: 'own-transfer', account: '1360', via: 'company', company };
	if (LOAN.test(purpose)) return { kind: 'loan' };
	return null;
}
