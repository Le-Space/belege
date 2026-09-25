// Copies of one invoice: the same vendor and the same invoice number on two
// receipts whose files differ byte for byte (one from the mail, one
// downloaded or from the folder – equal bytes are refused at import already).
// Of each group one is kept – the one linked to a booking, else the oldest –
// and the others are marked, for "Als Duplikat aussortieren". Pure.

import { normalizeRef, vendorWords } from '../matching/normalize.js';

/** @typedef {Record<string, any>} Rec */

/** @param {Rec} r */
const numberOf = (r) => normalizeRef(r.invoiceNumber ?? r.extraction?.invoice_number ?? '');
/** @param {Rec} r */
const vendorOf = (r) => vendorWords(r.vendor ?? r.extraction?.vendor ?? '').join(' ');

/**
 * @param {Rec[]} receipts
 * @param {(id: string) => Rec | null | undefined} matchOf the receipt's active match
 * @returns {Map<string, { of: string }>} receipt id → the receipt it copies
 */
export function findDuplicates(receipts, matchOf) {
	/** @type {Map<string, Rec[]>} */
	const groups = new Map();
	for (const r of receipts) {
		if (r.deleted || r.status === 'ignoriert') continue;
		const number = numberOf(r);
		const vendor = vendorOf(r);
		if (number.length < 4 || !vendor) continue;
		const key = `${vendor}|${number}`;
		groups.set(key, [...(groups.get(key) ?? []), r]);
	}
	/** @type {Map<string, { of: string }>} */
	const out = new Map();
	for (const group of groups.values()) {
		if (group.length < 2) continue;
		// Different amounts are no copies (an invoice and its correction).
		const amounts = new Set(group.map((r) => r.amountCents).filter((a) => typeof a === 'number'));
		if (amounts.size > 1) continue;
		const keeper =
			group.find((r) => matchOf(r.id)) ??
			[...group].sort((a, b) =>
				String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))
			)[0];
		for (const r of group) if (r.id !== keeper.id) out.set(r.id, { of: keeper.id });
	}
	return out;
}
