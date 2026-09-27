// What the pages show of matching: coverage, badges, candidates for "Beleg
// zuordnen", the query for the private-mailbox search and how its hits rank.
// Pure, so it is tested without a database or a browser.

import { isActive } from './engine.js';
import { receiptFacts, scorePair, txFacts } from './score.js';
import { STOP_WORDS, dayNumber, vendorWords } from './normalize.js';
import { partnerOfTx } from './partners.js';
import { isOwnName } from './classify.js';
import { MIRROR_DAYS, normalizeTxRef } from './context.js';
import { findDuplicates } from '../receipts/duplicates.js';
import { assetOf } from '../assets/registry.js';
import { txDirection } from '../bank/format.js';
import { walletChain } from '../wallets/chains.js';

/** @typedef {import('./classify.js').Classification} Classification */
/** @typedef {{ id: string } & Record<string, any>} Rec */

/**
 * Covered: a linked receipt, "Kein Beleg nötig", or a classification that
 * needs none (own transfer, bank fee, loan, a rule).
 *
 * @param {{ id: string, receiptId?: string | null, noReceipt?: any }} tx
 * @param {Record<string, Classification>} classifications
 */
export function isTxCovered(tx, classifications) {
	return Boolean(tx.receiptId) || Boolean(tx.noReceipt) || Boolean(classifications[tx.id]);
}

/**
 * The badge a booking carries in the list: `receipt`, one of the no-receipt
 * kinds, `no-receipt` (a person's "Kein Beleg nötig"), or null (missing).
 *
 * @param {{ id: string, receiptId?: string | null, noReceipt?: any }} tx
 * @param {Record<string, Classification>} classifications
 * @returns {string | null}
 */
export function coverageBadge(tx, classifications) {
	if (tx.receiptId) return 'receipt';
	if (tx.noReceipt) return 'no-receipt';
	return classifications[tx.id]?.kind ?? null;
}

/**
 * The active matches of a booking, oldest first.
 *
 * @param {string} transactionId
 * @param {Record<string, any>[]} matches
 */
export function matchesOfTx(transactionId, matches) {
	return matches
		.filter((m) => m.transactionId === transactionId && isActive(m))
		.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The active match of a receipt, if any.
 *
 * @param {string} receiptId
 * @param {Record<string, any>[]} matches
 */
export function matchOfReceipt(receiptId, matches) {
	return matches.find((m) => m.receiptId === receiptId && isActive(m)) ?? null;
}

/**
 * What ties a receipt to a crypto payment, if anything: the transaction hash,
 * the other address, or the quantity together with the asset's symbol,
 * somewhere in its subject, mail text, read text, file name or number.
 * Without one of them, a receipt is no candidate for a wallet booking –
 * however close its euro amount (#95).
 *
 * @param {Rec} tx
 * @param {Rec} r
 * @returns {'hash' | 'address' | 'amount' | null}
 */
export function cryptoEvidence(tx, r) {
	const hay = [
		r.subject,
		r.excerpt,
		r.extractionSent,
		r.fileName,
		r.invoiceNumber,
		r.extraction?.summary
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
	if (!hay) return null;
	const hash = normalizeTxRef(tx.txRef);
	if (hash.length >= 16 && hay.includes(hash)) return 'hash';
	const address = String(tx.counterpartyAddress ?? '')
		.trim()
		.toLowerCase()
		.replace(/^0x/, '');
	if (address.length >= 16 && hay.includes(address)) return 'address';
	const asset = String(tx.asset ?? '').toLowerCase();
	if (asset && typeof tx.quantity === 'string' && hay.includes(asset)) {
		const spellings = quantitySpellings(
			tx.quantity,
			Number(tx.decimals ?? assetOf(tx.asset)?.decimals)
		)
			// "5" or "0,00" says nothing: at least three digits.
			.filter((q) => q.replace(/\D/g, '').replace(/^0+/, '').length >= 3);
		for (const q of spellings) {
			const at = new RegExp(`(^|[^\\d.,])${q.replace(/[.]/g, '\\.')}(?![\\d])`);
			if (at.test(hay)) return 'amount';
		}
	}
	return null;
}

/**
 * Receipts for "Beleg zuordnen": every read receipt not linked elsewhere,
 * best score against this booking first; the ones that fit (≥ 40) are the
 * suggestions.
 *
 * @template {Rec} R
 * @param {Rec} tx
 * @param {R[]} receipts
 * @param {Record<string, any>[]} matches
 * @param {{ companyNames?: string[], learnedVendors?: Map<string, string[]> }} [ctx]
 * @returns {{ receipt: R, score: number, reasons: string[], suggested: boolean }[]}
 */
export function receiptChoices(tx, receipts, matches, ctx = {}) {
	const linkedElsewhere = new Set(
		matches.filter((m) => isActive(m) && m.transactionId !== tx.id).map((m) => m.receiptId)
	);
	const linkedHere = new Set(matchesOfTx(tx.id, matches).map((m) => m.receiptId));
	// A copy of an invoice whose original is linked already is no candidate.
	const copies = findDuplicates(receipts, (id) =>
		matches.find((m) => isActive(m) && m.receiptId === id)
	);
	const t = txFacts(tx, ctx);
	const crypto = Boolean(walletChain(tx.source));
	return receipts
		.filter(
			(r) =>
				!r.deleted &&
				!linkedElsewhere.has(r.id) &&
				!linkedHere.has(r.id) &&
				!copies.has(r.id) &&
				r.status !== 'rückfrage' &&
				r.status !== 'ignoriert'
		)
		.map((r) => {
			const facts = receiptFacts(r, ctx);
			const s = facts ? scorePair(facts, t) : { score: 0, reasons: [] };
			// A crypto payment: only a receipt that names its hash, address or quantity.
			const evidence = crypto ? cryptoEvidence(tx, r) : null;
			const reasons = evidence ? [...s.reasons, `crypto-${evidence}`] : s.reasons;
			return {
				receipt: r,
				score: s.score,
				reasons,
				evidence,
				suggested: crypto ? Boolean(evidence) : s.score >= 40
			};
		})
		.sort((a, b) => b.score - a.score || (a.receipt.id < b.receipt.id ? 1 : -1));
}

/**
 * The receipts "✦ KI-Vorschlag" sends for a booking: at most `max` of the
 * free ones, nearest first – by amount, then by date – and each as its read
 * fields only (vendor, amount, currency, date, invoice number, summary).
 *
 * @param {Rec} tx
 * @param {{ receipt: Rec, reasons?: string[], evidence?: string | null }[]} choices from receiptChoices
 * @param {number} [max]
 * @returns {{ id: string, vendor?: string, amount?: string, currency?: string, date?: string, number?: string, summary?: string }[]}
 */
export function assistCandidates(tx, choices, max = 25) {
	const cents = Math.abs(Number(tx.amountCents ?? 0));
	const day = dayNumber(tx.bookedOn) ?? 0;
	/** @param {Rec} r */
	const dateOf = (r) =>
		r.documentDate ?? r.extraction?.invoice_date ?? String(r.receivedAt ?? '').slice(0, 10);
	const crypto = Boolean(walletChain(tx.source));
	return (
		choices
			// Never the other direction (an expense for money received), and for a
			// crypto payment only receipts that name its hash, address or quantity.
			.filter((c) => !(c.reasons ?? []).includes('wrong-direction') && (!crypto || c.evidence))
			.map((c) => c.receipt)
			.filter((r) => r.extraction)
			.map((r) => ({
				r,
				amountGap:
					typeof r.amountCents === 'number' ? Math.abs(Math.abs(r.amountCents) - cents) : Infinity,
				dayGap: Math.abs((dayNumber(dateOf(r)) ?? day + 9999) - day)
			}))
			.sort((a, b) => a.amountGap - b.amountGap || a.dayGap - b.dayGap)
			.slice(0, max)
			.map(({ r }) => {
				/** @type {{ id: string } & Record<string, string>} */
				const out = { id: String(r.id) };
				const vendor = r.vendor ?? r.extraction?.vendor;
				if (vendor) out.vendor = String(vendor).slice(0, 120);
				if (typeof r.amountCents === 'number')
					out.amount = (r.amountCents / 100).toFixed(2).replace('.', ',');
				if (r.currency) out.currency = String(r.currency).slice(0, 3);
				if (dateOf(r)) out.date = String(dateOf(r)).slice(0, 10);
				const number = r.invoiceNumber ?? r.extraction?.invoice_number;
				if (number) out.number = String(number).slice(0, 60);
				if (r.extraction?.summary) out.summary = String(r.extraction.summary).slice(0, 120);
				return out;
			})
	);
}

/**
 * A name worth asking "Ist das deine Firma?": a booking on another of our
 * accounts has the opposite amount within a few days and names the same
 * counterparty. That is a transfer between our accounts – or a vendor who
 * refunded to the other account; the person knows which, the matching does
 * not guess (classify.js).
 *
 * @param {Rec} tx
 * @param {Rec[]} transactions
 * @param {string[]} [companyNames] already known: nothing to ask
 * @returns {{ name: string, other: Rec } | null}
 */
export function ownNameCandidate(tx, transactions, companyNames = []) {
	const words = vendorWords(tx.counterparty).join(' ');
	const day = dayNumber(tx.bookedOn);
	if (!words || day === null || !tx.amountCents) return null;
	if (companyNames.some((c) => isOwnName(String(tx.counterparty ?? ''), c))) return null;
	const other = transactions.find((o) => {
		const d = dayNumber(o.bookedOn);
		return (
			!o.deleted &&
			o.id !== tx.id &&
			o.accountId !== tx.accountId &&
			o.amountCents === -tx.amountCents &&
			(o.currency ?? 'EUR') === (tx.currency ?? 'EUR') &&
			d !== null &&
			Math.abs(d - day) <= MIRROR_DAYS &&
			vendorWords(o.counterparty).join(' ') === words
		);
	});
	return other ? { name: String(tx.counterparty).trim(), other } : null;
}

/**
 * Other bookings with the same counterparty, newest first.
 *
 * @template {Rec} T
 * @param {Rec} tx
 * @param {T[]} transactions
 * @param {number} [limit]
 * @returns {T[]}
 */
export function otherPayments(tx, transactions, limit = 6) {
	const name = String(tx.counterparty ?? '')
		.trim()
		.toLowerCase();
	if (!name) return [];
	return transactions
		.filter(
			(o) =>
				o.id !== tx.id &&
				String(o.counterparty ?? '')
					.trim()
					.toLowerCase() === name
		)
		.sort((a, b) =>
			a.bookedOn === b.bookedOn ? (a.id < b.id ? 1 : -1) : a.bookedOn < b.bookedOn ? 1 : -1
		)
		.slice(0, limit);
}

/** The first word of a name that says who it is: no legal form, no filler, three letters or more. */
function searchWord(/** @type {unknown} */ s) {
	for (const word of String(s ?? '').split(/[^\p{L}\p{N}]+/u)) {
		const plain = word.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
		if (word.length >= 3 && !STOP_WORDS.has(plain) && !/^\d+$/.test(word)) return word;
	}
	return null;
}

/** `-5259` → `52,59`; `-119000` → `1190,00` (the bridge tries every spelling). */
export function searchAmount(/** @type {number} */ cents) {
	const abs = Math.abs(Math.trunc(cents));
	return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export const SEARCH_DAYS = 14;

/** A crypto payment: its confirmation mail comes within days, not weeks. */
export const CRYPTO_SEARCH_DAYS = 3;
/** The bridge takes at most this many extra terms. */
export const MAX_TERMS = 6;

/**
 * A quantity of units as a vendor's mail may write it: exact (`1171.288052`)
 * and to two decimals (`1171.29`), each with a point and a comma; no sign,
 * no thousands separator.
 *
 * @param {string} units integer string, maybe negative
 * @param {number} decimals
 * @returns {string[]}
 */
export function quantitySpellings(units, decimals) {
	if (!/^-?\d+$/.test(units) || !Number.isInteger(decimals) || decimals < 0) return [];
	const abs = units.replace(/^-/, '').padStart(decimals + 1, '0');
	const int = abs.slice(0, abs.length - decimals).replace(/^0+(?=\d)/, '');
	const frac = abs.slice(abs.length - decimals).replace(/0+$/, '');
	const exact = frac ? `${int}.${frac}` : int;
	// Two decimals, rounded half up, in integers only.
	const scaled = BigInt(abs) * 100n;
	const unit = 10n ** BigInt(decimals);
	const cents = (scaled * 2n + unit) / (unit * 2n);
	const two = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
	const spellings = [exact, two].filter((v, i, all) => all.indexOf(v) === i);
	return spellings.flatMap((v) => (v.includes('.') ? [v, v.replace('.', ',')] : [v]));
}

/**
 * The terms a crypto payment's mail is found by, most telling first: the
 * transaction hash, the other address, the quantity. Only letters, digits
 * and `.,:_-`, 3 to 100 characters (what the bridge accepts).
 *
 * @param {Record<string, any>} tx
 * @returns {string[]}
 */
export function cryptoSearchTerms(tx) {
	const terms = [
		String(tx.txRef ?? '').trim(),
		String(tx.counterpartyAddress ?? '').trim(),
		...(typeof tx.quantity === 'string'
			? quantitySpellings(tx.quantity, Number(tx.decimals ?? assetOf(tx.asset)?.decimals))
			: [])
	];
	return terms
		.filter((v) => /^[\w.,:-]{3,100}$/.test(v))
		.filter((v, i, all) => all.indexOf(v) === i)
		.slice(0, MAX_TERMS);
}

/** A wallet booking's memo, from its purpose (`… · Memo: … · Tx …`). @param {Record<string, any>} tx */
export function memoOf(tx) {
	const m = /(?:^|·)\s*Memo:\s*([^·]+?)\s*(?:·|$)/.exec(String(tx.purpose ?? ''));
	return m ? m[1].slice(0, 100) : null;
}

/**
 * What "Im privaten Postfach suchen" asks the bridge: the counterparty's
 * first telling word (the purpose's, when the counterparty has none), the
 * amount, and the booking day ± 14 days.
 *
 * With a learned partner (partners.js) its sender domains are searched too.
 *
 * An own wallet's booking is searched by what its mail carries instead
 * (cryptoSearchTerms): hash, address, quantity; the learned vendor of that
 * address, else the memo, as the text; ± 3 days. Not the euro amount: that
 * is our own valuation, not what the vendor billed.
 *
 * @param {Record<string, any>} tx
 * @param {Record<string, any>[]} [partners]
 * @returns {{ text: string | null, amount: string | null, from: string[], terms: string[], around: string, days: number }}
 */
export function privateSearchQuery(tx, partners = []) {
	const partner = partnerOfTx(partners, tx);
	const from = (partner?.senderDomains ?? []).slice(0, 3);
	if (walletChain(tx.source)) {
		const word = partner ? searchWord(partner.name) : searchWord(memoOf(tx));
		return {
			text: word ? word.slice(0, 100) : null,
			amount: null,
			from,
			terms: cryptoSearchTerms(tx),
			around: String(tx.bookedOn),
			days: CRYPTO_SEARCH_DAYS
		};
	}
	const text = searchWord(tx.counterparty) ?? searchWord(tx.purpose);
	return {
		text: text ? text.slice(0, 100) : null,
		amount: searchAmount(Number(tx.amountCents ?? 0)),
		from,
		terms: [],
		around: String(tx.bookedOn),
		days: SEARCH_DAYS
	};
}

/**
 * Which criteria a hit matched: `text` (a search word, `"…"`), `sender` (a
 * known sender domain, `@…`), `amount` (any spelling).
 *
 * @param {{ matched?: string[] }} hit
 * @returns {('text' | 'sender' | 'amount')[]}
 */
export function hitCriteria(hit) {
	const m = hit.matched ?? [];
	/** @type {('text' | 'sender' | 'amount')[]} */
	const out = [];
	if (m.some((x) => x.startsWith('"'))) out.push('text');
	if (m.some((x) => x.startsWith('@'))) out.push('sender');
	if (m.some((x) => !x.startsWith('"') && !x.startsWith('@'))) out.push('amount');
	return out;
}

const RECEIPT_WORDS =
	/receipt|invoice|rechnung|quittung|beleg|zahlungsbest|payment confirm|bestellbest|order confirm/i;
const SIGN_IN_WORDS =
	/anmeld|sign.?in|log.?in|magic link|sicherer link|secure link|verif|bestätigungscode|security code|passwort|password/i;
/** A payment that did not go through: a notice, not the receipt (that comes with the retry). */
const FAILED_WORDS =
	/problem billing|payment (?:failed|declined|unsuccessful)|could not (?:be )?(?:charge|process)|zahlung (?:fehlgeschlagen|abgelehnt|nicht möglich)|konnte nicht (?:abgebucht|eingezogen)|zahlungsmethode aktualisieren|update your payment/i;

/**
 * How much a hit looks like the receipt, and why (docs/phase-0.md: a vendor
 * search also finds newsletters and sign-in mails, an amount search unrelated
 * mails). No LLM: the mail's own fields, deterministic.
 *
 * @param {{ matched?: string[], attachments?: any[], auth?: { verdict?: string }, receivedAt?: string | null, subject?: string, from?: { address?: string, name?: string }, bulk?: boolean }} h
 * @param {{ word?: string | null, around?: string | null }} [context] the search word, the booking day
 * @returns {{ score: number, why: string[] }}
 */
export function hitScore(h, { word = null, around = null } = {}) {
	let score = 0;
	/** @type {string[]} */
	const why = [];
	const add = (/** @type {number} */ n, /** @type {string} */ reason) => {
		score += n;
		why.push(reason);
	};
	const criteria = hitCriteria(h);
	if (criteria.includes('amount')) add(4, 'amount');
	if (criteria.includes('text')) add(1, 'word');
	const w = String(word ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9äöüß]/g, '');
	const address = String(h.from?.address ?? '').toLowerCase();
	const domain = address.split('@')[1] ?? '';
	if (criteria.includes('sender')) add(4, 'known-sender');
	else if (
		w.length >= 3 &&
		(domain.includes(w) ||
			String(h.from?.name ?? '')
				.toLowerCase()
				.includes(w))
	)
		add(4, 'sender');
	const files = (h.attachments ?? []).filter((a) => a.kind === 'pdf' || a.kind === 'image');
	if (files.length) add(3, 'attachment');
	if (files.some((a) => RECEIPT_WORDS.test(String(a.name ?? '')))) add(2, 'attachment-name');
	const subject = String(h.subject ?? '');
	if (RECEIPT_WORDS.test(subject)) add(3, 'subject');
	if (SIGN_IN_WORDS.test(subject)) add(-4, 'sign-in');
	if (FAILED_WORDS.test(subject)) add(-4, 'payment-failed');
	if (h.bulk) add(-3, 'newsletter');
	if (h.auth?.verdict === 'pass') add(1, 'sender-check');
	if (around && h.receivedAt) {
		const days =
			Math.abs(Date.parse(String(h.receivedAt)) - Date.parse(`${around}T12:00:00Z`)) / 864e5;
		if (days <= 3) add(2, 'date');
	}
	return { score, why };
}

/**
 * Hits, most likely receipt first (hitScore), then the newest.
 *
 * @template {Parameters<typeof hitScore>[0]} H
 * @param {H[]} hits
 * @param {Parameters<typeof hitScore>[1]} [context]
 * @returns {H[]}
 */
export function rankHits(hits, context = {}) {
	const scored = hits.map((h) => ({ h, s: hitScore(h, context).score }));
	return scored
		.sort(
			(a, b) =>
				b.s - a.s || String(b.h.receivedAt ?? '').localeCompare(String(a.h.receivedAt ?? ''))
		)
		.map((x) => x.h);
}

/**
 * The one hit that is clearly the receipt: it looks like one (score ≥ 10) and
 * leads the next by 4 or more. Null when it is not that clear.
 *
 * @template {Parameters<typeof hitScore>[0]} H
 * @param {H[]} ranked from rankHits
 * @param {Parameters<typeof hitScore>[1]} [context]
 * @returns {H | null}
 */
export function likelyHit(ranked, context = {}) {
	if (!ranked.length) return null;
	const first = hitScore(ranked[0], context).score;
	const second = ranked[1] ? hitScore(ranked[1], context).score : -Infinity;
	return first >= 10 && first - second >= 4 ? ranked[0] : null;
}

/**
 * Questions for the Home card: how many are open, how many of all were
 * settled.
 *
 * @param {Record<string, any>[]} questions
 */
export function questionProgress(questions) {
	const live = questions.filter((q) => !q.deleted);
	const open = live.filter((q) => q.state === 'open').length;
	return { open, done: live.length - open, total: live.length };
}

/**
 * "Als Gegenbuchung verknüpfen …": the bookings that could be this one's other
 * side (issue #98) – on another account, the other way, within a month; the
 * closest first, by quantity for the same crypto asset, else by euro amount,
 * then by date. A search narrows them by counterparty, purpose, type or amount.
 *
 * @param {Record<string, any>} tx
 * @param {Record<string, any>[]} transactions
 * @param {{ query?: string, days?: number, limit?: number }} [options]
 * @returns {Record<string, any>[]}
 */
export function transferCandidates(tx, transactions, { query = '', days = 31, limit = 8 } = {}) {
	const day = dayNumber(tx.bookedOn);
	const way = txDirection(tx);
	if (day === null || !way) return [];
	const q = query.trim().toLowerCase();
	/** @param {Record<string, any>} o */
	const gap = (o) => {
		if (tx.asset && o.asset === tx.asset && /^-?\d+$/.test(String(tx.quantity ?? ''))) {
			const a = BigInt(tx.quantity) < 0n ? -BigInt(tx.quantity) : BigInt(tx.quantity);
			const raw = /^-?\d+$/.test(String(o.quantity ?? '')) ? BigInt(o.quantity) : 0n;
			const b = raw < 0n ? -raw : raw;
			return a ? Number(((a > b ? a - b : b - a) * 10000n) / a) / 10000 : 1;
		}
		const a = Math.abs(Number(tx.amountCents ?? 0));
		const b = Math.abs(Number(o.amountCents ?? 0));
		return a ? Math.abs(a - b) / a : 1;
	};
	return transactions
		.filter((o) => {
			if (o.deleted || o.id === tx.id || o.accountId === tx.accountId) return false;
			if (o.movement === 'fee' || txDirection(o) !== -way) return false;
			const d = dayNumber(o.bookedOn);
			if (d === null || Math.abs(d - day) > days) return false;
			if (!q) return true;
			return [o.counterparty, o.purpose, o.bookingType, String(Math.abs(o.amountCents ?? 0) / 100)]
				.map((v) => String(v ?? '').toLowerCase())
				.some((v) => v.includes(q.replace(',', '.')) || v.includes(q));
		})
		.map((o) => ({
			o,
			g: gap(o),
			d: Math.abs(/** @type {number} */ (dayNumber(o.bookedOn)) - day)
		}))
		.sort((x, y) => x.g - y.g || x.d - y.d)
		.slice(0, limit)
		.map((x) => x.o);
}

/**
 * The check "Umbuchung mit Beleg" (Home): payments that count as an own
 * transfer now – by a newer rule, a link by hand – but still have a receipt
 * linked from before. The matching never undoes a link, so a person looks:
 * unlink it, or say it is right. An Eigenbeleg made for the payment is left
 * out: it was written for it on purpose.
 *
 * @param {{ transactions: Record<string, any>[], receipts: Record<string, any>[], matches: Record<string, any>[], classifications: Record<string, any>, kept?: string[] }} books
 * @returns {{ tx: Record<string, any>, receipt: Record<string, any>, matchId: string | null }[]}
 */
export function transfersWithReceipt({
	transactions,
	receipts,
	matches,
	classifications,
	kept = []
}) {
	const keep = new Set(kept);
	const receiptById = new Map(receipts.filter((r) => !r.deleted).map((r) => [String(r.id), r]));
	/** @type {{ tx: Record<string, any>, receipt: Record<string, any>, matchId: string | null }[]} */
	const found = [];
	for (const tx of transactions) {
		if (tx.deleted || classifications[tx.id]?.kind !== 'own-transfer') continue;
		/** @type {Map<string, string | null>} receipt id → match id */
		const linked = new Map();
		for (const m of matchesOfTx(tx.id, matches)) linked.set(String(m.receiptId), String(m.id));
		if (tx.receiptId && !linked.has(String(tx.receiptId))) linked.set(String(tx.receiptId), null);
		for (const [receiptId, matchId] of linked) {
			const receipt = receiptById.get(receiptId);
			if (!receipt || receipt.source === 'eigenbeleg') continue;
			if (keep.has(`${tx.id}|${receiptId}`)) continue;
			found.push({ tx, receipt, matchId });
		}
	}
	return found.sort((a, b) => String(b.tx.bookedOn).localeCompare(String(a.tx.bookedOn)));
}
