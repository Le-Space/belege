// A vendor account (issue #121): one vendor's payments and receipts on one
// timeline, with a running balance. For vendors that never pair one payment
// with one receipt – a prepaid tariff whose bank lines are top-ups and whose
// "invoices" are statements of what the credit was used for – what has to add
// up is the account: opening balance + top-ups − consumption = balance, never
// below zero. Pure; fixed rules, no AI.
//
// A payment belongs to the vendor when its payee name (bank/payee.js) is the
// same vendor (normalize.js sameVendor), a receipt when its vendor is. Money
// out is a top-up, money back from the vendor a negative one; a receipt's
// gross is consumption. Our own invoices are left out.

import { sameVendor, dayNumber } from './normalize.js';
import { payeeName } from '../bank/payee.js';

/** @typedef {Record<string, any>} Rec */

/** @param {Rec} r */
export const receiptCents = (r) =>
	typeof r.amountCents === 'number'
		? r.amountCents
		: typeof r.extraction?.gross === 'number' && Number.isFinite(r.extraction.gross)
			? Math.round(r.extraction.gross * 100)
			: null;

/** @param {Rec} r */
const receiptDay = (r) => {
	const d =
		r.documentDate ??
		r.extraction?.invoice_date ??
		(typeof r.receivedAt === 'string' ? r.receivedAt : null);
	return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : null;
};

/** @param {Rec} r */
const receiptVendorName = (r) => String(r.vendor ?? r.extraction?.vendor ?? '');

/** Whether a payment is the vendor's. @param {string} name @param {Rec} tx */
export const isVendorPayment = (name, tx) =>
	!tx.deleted && tx.movement !== 'fee' && sameVendor(name, payeeName(tx).name);

/** Whether a receipt is the vendor's (not one of our own invoices). @param {string} name @param {Rec} r */
export const isVendorReceipt = (name, r) =>
	!r.deleted && !r.outgoing && sameVendor(name, receiptVendorName(r));

/**
 * @typedef {object} Row
 * @property {string} date YYYY-MM-DD
 * @property {'payment' | 'receipt'} kind
 * @property {string} id
 * @property {string} label
 * @property {number} topUpCents money to the vendor (negative: back from it)
 * @property {number} usageCents what a receipt bills
 * @property {number} balanceCents after this row
 * @property {{ from: string, to: string } | null} [period] what a statement bills, as read from it
 * @property {{ description: string, cents: number }[]} [items] its positions, as read
 */

/**
 * @typedef {object} Finding
 * @property {'negative' | 'gap' | 'no-statements' | 'january' | 'previous-year' | 'unknown-opening'} kind
 * @property {string} [date]
 * @property {string} [month] YYYY-MM, for a gap
 * @property {number} [cents]
 */

/**
 * The vendor's timeline between two days, with its balance and what does not add up.
 *
 * @param {object} p
 * @param {Rec[]} p.transactions
 * @param {Rec[]} p.receipts
 * @param {string} p.name the vendor
 * @param {string} p.from YYYY-MM-DD, first day
 * @param {string} p.until YYYY-MM-DD, last day
 * @param {number | null} [p.openingCents] the balance at `from`; null when not known
 */
export function vendorTimeline({ transactions, receipts, name, from, until, openingCents = null }) {
	const inRange = (/** @type {string | null} */ d) => d !== null && d >= from && d <= until;
	/** @type {Omit<Row, 'balanceCents'>[]} */
	const raw = [];
	for (const tx of transactions) {
		if (!isVendorPayment(name, tx) || !inRange(String(tx.bookedOn ?? ''))) continue;
		const cents = Number(tx.amountCents ?? 0);
		if (!cents) continue;
		raw.push({
			date: String(tx.bookedOn),
			kind: 'payment',
			id: String(tx.id),
			label: payeeName(tx).name,
			topUpCents: -cents,
			usageCents: 0
		});
	}
	for (const r of receipts) {
		const day = receiptDay(r);
		const cents = receiptCents(r);
		if (!isVendorReceipt(name, r) || !inRange(day) || cents === null || cents <= 0) continue;
		const sp = r.extraction?.service_period;
		const period =
			sp && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)
				? { from: String(sp.from), to: String(sp.to) }
				: null;
		const items = Array.isArray(r.extraction?.line_items)
			? r.extraction.line_items
					.filter((/** @type {any} */ i) => i && typeof i.amount === 'number')
					.slice(0, 20)
					.map((/** @type {any} */ i) => ({
						description: String(i.description ?? '').slice(0, 120),
						cents: Math.round(i.amount * 100)
					}))
			: [];
		raw.push({
			date: /** @type {string} */ (day),
			kind: 'receipt',
			id: String(r.id),
			label: receiptVendorName(r),
			topUpCents: 0,
			usageCents: cents,
			period,
			items
		});
	}
	// Same day: the top-up first, so a statement of that day draws on it.
	raw.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === 'payment' ? -1 : 1));

	/** @type {Finding[]} */
	const findings = [];
	let balance = openingCents ?? 0;
	let wentNegative = false;
	/** @type {Row[]} */
	const rows = raw.map((r) => {
		balance += r.topUpCents - r.usageCents;
		if (balance < 0 && !wentNegative) {
			wentNegative = true;
			findings.push({ kind: 'negative', date: r.date, cents: balance });
		}
		return { ...r, balanceCents: balance };
	});

	const statements = rows.filter((r) => r.kind === 'receipt');
	const topUps = rows.filter((r) => r.kind === 'payment' && r.topUpCents > 0);
	if (openingCents === null && rows[0]?.kind === 'receipt') {
		findings.unshift({ kind: 'unknown-opening', date: rows[0].date });
	}
	if (topUps.length && !statements.length) findings.push({ kind: 'no-statements' });
	// A month without a statement, between the first and the last. Where the
	// statements say what they bill (their period), the months billed count –
	// a statement of 15 June for May covers May – else the months they are dated in.
	const withPeriods = statements.filter((r) => r.period);
	const billed = new Set();
	if (withPeriods.length >= Math.ceil(statements.length / 2)) {
		for (const r of withPeriods) {
			const p = /** @type {{ from: string, to: string }} */ (r.period);
			for (let m = p.from.slice(0, 7); m <= p.to.slice(0, 7); m = nextMonth(m)) billed.add(m);
		}
	} else {
		for (const r of statements) billed.add(r.date.slice(0, 7));
	}
	if (billed.size >= 2) {
		const months = [...billed].sort();
		for (let m = nextMonth(months[0]); m < months[months.length - 1]; m = nextMonth(m)) {
			if (!billed.has(m)) findings.push({ kind: 'gap', month: m });
		}
	}
	// January: a statement for last year's period bills the year before; one
	// early in January without a period may.
	for (const r of statements) {
		if (r.period && r.period.to.slice(0, 4) < r.date.slice(0, 4)) {
			findings.push({ kind: 'previous-year', date: r.date, cents: r.usageCents });
		} else if (!r.period && r.date.slice(5, 7) === '01' && Number(r.date.slice(8, 10)) <= 20) {
			findings.push({ kind: 'january', date: r.date, cents: r.usageCents });
		}
	}

	return {
		rows,
		openingCents,
		closingCents: balance,
		topUpCents: rows.reduce((n, r) => n + r.topUpCents, 0),
		usageCents: rows.reduce((n, r) => n + r.usageCents, 0),
		findings
	};
}

/** `2026-12` → `2027-01`. @param {string} month */
function nextMonth(month) {
	const [y, m] = month.split('-').map(Number);
	return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

// A statement that says it asks for no payment: prepaid, or billed elsewhere.
const NO_REQUEST =
	/keine\s+zahlungsaufforderung|no\s+request\s+for\s+payment|bereits\s+(?:bezahlt|beglichen)/i;

/**
 * Whether a vendor looks like a prepaid account: at least two payments and
 * two receipts, hardly any payment with a receipt of the same amount within
 * ten days, and round top-ups or statements saying they ask for no payment.
 *
 * @param {{ transactions: Rec[], receipts: Rec[], name: string }} p
 */
export function looksPrepaid({ transactions, receipts, name }) {
	const pays = transactions.filter((t) => isVendorPayment(name, t) && Number(t.amountCents) < 0);
	const recs = receipts.filter((r) => isVendorReceipt(name, r) && (receiptCents(r) ?? 0) > 0);
	if (pays.length < 2 || recs.length < 2) return false;
	const paired = pays.filter((t) =>
		recs.some((r) => {
			const a = dayNumber(t.bookedOn);
			const b = dayNumber(receiptDay(r));
			return (
				receiptCents(r) === -Number(t.amountCents) &&
				a !== null &&
				b !== null &&
				Math.abs(a - b) <= 10
			);
		})
	).length;
	if (paired / pays.length >= 0.5) return false;
	const round = pays.filter((t) => Number(t.amountCents) % 500 === 0).length / pays.length >= 0.5;
	const says = recs.some(
		(r) =>
			r.extraction?.no_payment_request === true ||
			NO_REQUEST.test(`${r.excerpt ?? ''} ${r.extraction?.summary ?? ''} ${r.text ?? ''}`)
	);
	return round || says;
}

/**
 * The prepaid vendors a person confirmed, as kept in the matching settings.
 *
 * @param {unknown} value
 * @returns {{ name: string, openings: Record<string, number> }[]}
 */
export function cleanPrepaidVendors(value) {
	if (!Array.isArray(value)) return [];
	return value
		.filter((v) => v && typeof v.name === 'string' && v.name.trim())
		.map((v) => ({
			name: String(v.name).trim().slice(0, 120),
			openings: Object.fromEntries(
				Object.entries(v.openings && typeof v.openings === 'object' ? v.openings : {}).filter(
					([y, c]) => /^\d{4}$/.test(y) && Number.isInteger(c)
				)
			)
		}))
		.slice(0, 100);
}
