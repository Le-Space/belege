// "Warum diese Zuordnung?": the stored reasons and score of a match, the rule
// behind a booking that needs no receipt, and the candidates of a question,
// in plain German. The matching itself is deterministic (score.js); these
// lines only say what it counted. Pure, so the sentences are tested.

import { accountLabel, formatDate, formatMoney } from '../bank/format.js';
import { t } from '../i18n/index.js';
import { POINTS, SURE, LEAD } from './score.js';

/** @typedef {Record<string, any>} Rec */

/** Reason code → the key in POINTS (score.js). */
const POINT_KEY = /** @type {Record<string, keyof typeof POINTS>} */ ({
	amount: 'amount',
	'invoice-number': 'invoiceNumber',
	'customer-number': 'customerNumber',
	iban: 'iban',
	vendor: 'vendor',
	'vendor-in-purpose': 'vendorInPurpose',
	'vendor-learned': 'vendorLearned',
	date: 'date',
	'far-date': 'farDate',
	'wrong-direction': 'wrongDirection'
});

/**
 * One reason as a phrase, with the value that matched where there is one.
 *
 * @param {string} code a reason from scorePair (`amount`, `invoice-number`, …)
 * @param {{ tx?: Rec | null, receipt?: Rec | null }} [facts]
 * @returns {string | null} null for `manual` (the state says it)
 */
export function reasonPhrase(code, { tx = null, receipt = null } = {}) {
	const vendor = String(receipt?.vendor ?? receipt?.extraction?.vendor ?? '').trim();
	const invoice = String(
		receipt?.invoiceNumber ?? receipt?.extraction?.invoice_number ?? ''
	).trim();
	const customer = String(receipt?.extraction?.customer_number ?? '').trim();
	switch (code) {
		case 'manual':
			return null;
		case 'amount':
			return tx && typeof tx.amountCents === 'number'
				? t('explain.reason.amountValue', {
						amount: formatMoney(tx.amountCents, tx.currency ?? 'EUR')
					})
				: t('explain.reason.amount');
		case 'invoice-number':
			return invoice
				? t('explain.reason.invoiceValue', { number: invoice })
				: t('explain.reason.invoice');
		case 'customer-number':
			return customer
				? t('explain.reason.customerValue', { number: customer })
				: t('explain.reason.customer');
		case 'vendor':
			return vendor ? t('explain.reason.vendorValue', { vendor }) : t('explain.reason.vendor');
		case 'vendor-learned':
			return vendor
				? t('explain.reason.vendorLearnedValue', {
						vendor,
						counterparty: String(tx?.counterparty ?? '').trim()
					})
				: t('explain.reason.vendorLearned');
		case 'vendor-in-purpose':
			return vendor
				? t('explain.reason.vendorInPurposeValue', { vendor })
				: t('explain.reason.vendorInPurpose');
		case 'iban':
		case 'date':
		case 'far-date':
		case 'wrong-direction':
			return t(`explain.reason.${code}`);
		default:
			return code;
	}
}

/**
 * The reasons joined, the way the app says them.
 *
 * @param {string[] | null | undefined} reasons
 * @param {{ tx?: Rec | null, receipt?: Rec | null }} [facts]
 */
export function reasonsText(reasons, facts = {}) {
	return (reasons ?? [])
		.map((code) => reasonPhrase(code, facts))
		.filter(Boolean)
		.join(' · ');
}

/**
 * "Betrag gleich (-15,46 EUR) · Rechnungsnummer 082001098720 im
 * Verwendungszweck · Anbieter Hetzner · Datum passt – 140 Punkte,
 * automatisch zugeordnet".
 *
 * @param {Rec} match a matches record: score, reasons, state
 * @param {{ tx?: Rec | null, receipt?: Rec | null }} [facts]
 */
export function matchLine(match, facts = {}) {
	const reasons = Array.isArray(match.reasons) ? match.reasons : [];
	const byHand = reasons.includes('manual');
	const how =
		match.state === 'auto'
			? t('explain.how.auto')
			: byHand
				? t('explain.how.manual')
				: t('explain.how.confirmed');
	const what = reasonsText(reasons, facts);
	const points =
		typeof match.score === 'number' ? t('explain.points', { score: match.score }) : null;
	const tail = [points, how].filter(Boolean).join(', ');
	return what ? `${what} – ${tail}` : tail;
}

/**
 * The points behind a score, for the technical view:
 * "Betrag +40 · Rechnungsnummer +50 · … = 140 Punkte".
 *
 * @param {string[] | null | undefined} reasons
 * @param {number | null | undefined} score
 */
export function pointsBreakdown(reasons, score) {
	const parts = (reasons ?? [])
		.filter((code) => code in POINT_KEY)
		.map((code) => {
			const p = POINTS[POINT_KEY[code]];
			return `${t(`matching.reason.${code}`)} ${p > 0 ? '+' : '−'}${Math.abs(p)}`;
		});
	if (!parts.length) return '';
	return `${parts.join(' · ')} = ${t('explain.points', {
		score: typeof score === 'number' ? score : parts.length
	})}`;
}

/** The thresholds, for the technical view. */
export function thresholdsText() {
	return t('explain.thresholds', { sure: SURE, lead: LEAD });
}

/** `n1u6tl…w6d0y`: an address short enough for a sentence. @param {string} address */
const shortAddress = (address) =>
	address.length > 16 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address;

const FIELD_KEY = /** @type {Record<string, string>} */ ({
	counterparty: 'explain.field.counterparty',
	purpose: 'explain.field.purpose',
	any: 'explain.field.any'
});

/**
 * Why a booking needs no receipt: the rule that applied, in words.
 *
 * @param {import('./classify.js').Classification | null | undefined} c
 * @param {{ accounts?: Rec[], noReceipt?: { reason?: string } | null }} [context]
 * @returns {string | null}
 */
export function classificationLine(c, { accounts = [], noReceipt = null } = {}) {
	if (noReceipt) {
		return t('explain.rule.noReceipt', { reason: noReceipt.reason || t('explain.rule.noReason') });
	}
	if (!c) return null;
	switch (c.kind) {
		case 'own-transfer': {
			if (c.via === 'counter-booking' || c.via === 'reference') {
				const other = accounts.find((a) => a.id === c.counterAccountId);
				return t('explain.rule.ownCounter', {
					account: other ? `${accountLabel(other)}` : t('explain.rule.otherAccount'),
					date: c.counterDay ? formatDate(c.counterDay) : '?',
					sign: c.sign ?? ''
				});
			}
			if (c.via === 'own-address') {
				const other = accounts.find((a) => a.id === c.counterAccountId);
				return t('explain.rule.ownAddress', {
					address: shortAddress(c.address ?? ''),
					account: other ? accountLabel(other) : t('explain.rule.otherAccount')
				});
			}
			if (c.via === 'staking') return t('explain.rule.staking');
			if (c.via === 'company') {
				return t('explain.rule.ownCompany', { company: c.company ?? '' });
			}
			const own = accounts.find(
				(a) => String(a.ibanLast4 ?? '').toUpperCase() === String(c.ibanLast4 ?? '').toUpperCase()
			);
			const account = own ? `${accountLabel(own)}` : `···${c.ibanLast4 ?? ''}`;
			return t(c.via === 'mirrored' ? 'explain.rule.ownMirrored' : 'explain.rule.ownIban', {
				account
			});
		}
		case 'bank-fee':
			if (c.via === 'exchange-fee') return t('explain.rule.exchangeFee');
			if (c.via === 'network-fee') return t('explain.rule.networkFee');
			if (c.via === 'bank-code') return t('explain.rule.bankFeeCode', { code: c.bankCode ?? '' });
			if (c.via === 'fee-words') return t('explain.rule.bankFeeWords', { word: c.feeWord ?? '' });
			if (c.via === 'learned') return t('explain.rule.bankFeeLearned');
			return t('explain.rule.bankFee', { type: c.bookingType ?? '' });
		case 'loan':
			return t('explain.rule.loan');
		case 'crypto-reward':
			return t('explain.rule.cryptoReward');
		case 'rule-ignore':
		case 'rule-private':
			return t(c.kind === 'rule-private' ? 'explain.rule.private' : 'explain.rule.ignore', {
				field: t(FIELD_KEY[c.ruleField ?? 'counterparty'] ?? FIELD_KEY.counterparty),
				contains: c.ruleContains ?? c.reason ?? '',
				reason: c.reason ?? ''
			});
		default:
			return null;
	}
}

/**
 * A question's candidate: "70 Punkte: Betrag gleich (-52,59 EUR) · Anbieter
 * Stromwerk · Datum passt".
 *
 * @param {{ score: number, reasons: string[] }} candidate
 * @param {{ tx?: Rec | null, receipt?: Rec | null }} [facts]
 */
export function candidateLine(candidate, facts = {}) {
	const what = reasonsText(candidate.reasons, facts);
	const points = t('explain.points', { score: candidate.score });
	return what ? `${points}: ${what}` : points;
}
