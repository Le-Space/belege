// The private share of a payment: a telephone or internet bill that is partly
// private use is booked in two parts – the business share on its expense
// account with its BU key, the private share on the account the books settle
// private use on, without a key (so no input tax is deducted on it). The bank
// booking stays one; the DATEV export writes two lines that add up to it
// (export/plan.js).
//
// Where a share comes from, in this order (suggest.js):
//   1. what the person confirmed for this payment (`booking.privateShare`);
//   2. what they confirmed for this vendor last time (partners.js);
//   3. the books' rule for telecommunication (settings.js `privateShare`):
//      one percentage for a landline or fixed internet connection, one for
//      everything else (mobile), found by words in the payment and its
//      receipt. Off until the books set a percentage and an account.
// The percentages are the tax adviser's; nothing here knows what is right.
// Pure.
import { isAccountNumber } from './skr03.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {{ percent: number, account: string }} PrivateShare `percent`: the private part, 1 to 99 */
/** @typedef {'confirmed' | 'learned' | 'landline' | 'mobile'} PrivateShareVia */

/**
 * A stored or typed share, cleaned; null for none or one that cannot be.
 *
 * @param {unknown} value
 * @returns {PrivateShare | null}
 */
export function cleanPrivateShare(value) {
	const v = /** @type {Rec | null} */ (value && typeof value === 'object' ? value : null);
	if (!v) return null;
	const percent = typeof v.percent === 'string' ? Number(v.percent.trim()) : v.percent;
	const account = String(v.account ?? '').trim();
	if (!Number.isInteger(percent) || percent < 1 || percent > 99) return null;
	if (!isAccountNumber(account)) return null;
	return { percent, account };
}

/**
 * A payment's two parts in cents: the private one rounded to the cent, the
 * business one the rest, so the two always add up to the payment.
 *
 * @param {number} amountCents signed
 * @param {number} percent the private part
 * @returns {{ business: number, private: number }}
 */
export function splitCents(amountCents, percent) {
	const total = Math.trunc(Number(amountCents) || 0);
	const part = Math.sign(total) * Math.round((Math.abs(total) * percent) / 100);
	return { business: total - part, private: part };
}

// Words of a telephone or internet bill, in German and English. A landline or
// fixed connection only when nothing mobile is named: a bundle counts as mobile.
const MOBILE =
	/\b(mobilfunk|mobiltelefon|mobile|prepaid|allnet|sim[- ]?karte|esim|handy|handyvertrag|smartphone[- ]?tarif|datenvolumen|roaming)\b/i;
const LANDLINE =
	/\b(festnetz|telefonanschluss|dsl|vdsl|glasfaser|kabelanschluss|kabel[- ]?internet|meinkabel|breitband|internetanschluss|landline|broadband|fib(er|re))\b/i;

/**
 * What kind of telecommunication bill the texts name, if any.
 *
 * @param {unknown[]} texts counterparty, purpose, the receipt's vendor and positions
 * @returns {'landline' | 'mobile' | null}
 */
export function telecomKind(texts) {
	const text = texts
		.map((x) => String(x ?? ''))
		.join(' ')
		// "www.example.de/meinkabel", "Prepaid-Konto": words apart.
		.replace(/[/._]+/g, ' ');
	if (MOBILE.test(text)) return 'mobile';
	if (LANDLINE.test(text)) return 'landline';
	return null;
}

/**
 * The share the books suggest for a payment that has none confirmed.
 *
 * @param {object} p
 * @param {Rec} p.tx
 * @param {Rec | null} p.receipt the first linked receipt
 * @param {Rec | null} p.partner the learned vendor
 * @param {{ account: string, landline: number, mobile: number } | null | undefined} p.rule settings.js `privateShare`
 * @returns {{ share: PrivateShare, via: PrivateShareVia } | null}
 */
export function suggestedShare({ tx, receipt, partner, rule }) {
	// Money that came in is no bill of ours.
	if (Number(tx?.amountCents ?? 0) >= 0) return null;
	if (partner && 'privateShare' in partner) {
		// Learned, also as "none": a vendor the person booked whole stays whole.
		const share = cleanPrivateShare(partner.privateShare);
		return share ? { share, via: 'learned' } : null;
	}
	if (!rule || !isAccountNumber(rule.account)) return null;
	const ex = /** @type {Rec} */ (receipt?.extraction ?? {});
	const kind = telecomKind([
		tx.counterparty,
		tx.purpose,
		receipt?.vendor ?? ex.vendor,
		...(Array.isArray(ex.line_items) ? ex.line_items : []).map(
			(/** @type {any} */ i) => i?.description
		)
	]);
	if (!kind) return null;
	const share = cleanPrivateShare({ percent: rule[kind], account: rule.account });
	return share ? { share, via: kind } : null;
}
