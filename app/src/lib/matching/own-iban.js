// "Ist das ein eigenes Konto?" (issue #256): an IBAN that sends money under the
// company's own name is very likely the company's own account – a Wise
// account, say, whose statements never name its IBAN. The payments coming
// back from it are own transfers already (classify.js, `via: 'company'`); the
// ones going to it are not, as long as the IBAN is unknown. So such an IBAN is
// offered: saved as an own IBAN, it explains every payment to it at once.
//
// Never saved by itself – a customer with a similar name pays from an account
// of their own – and an IBAN a person said is not theirs is not offered again.
// Pure; the page saves (matching/actions.js `addOwnIban`, `rejectOwnIban`).

import { compactIban } from './normalize.js';

/** @typedef {Record<string, any>} Rec */

/**
 * @typedef {object} OwnIbanSuggestion
 * @property {string} iban compact
 * @property {string} sender the name it sent under (the company's)
 * @property {Rec[]} incoming bookings from it, recognised by the name
 * @property {Rec[]} outgoing open bookings to it: what saving it explains
 */

/**
 * @param {object} books
 * @param {Rec[]} books.transactions
 * @param {Record<string, Rec>} books.classifications
 * @param {string[]} [books.ownIbans] already own (Einstellungen)
 * @param {string[]} [books.notOwnIbans] a person said: not ours
 * @returns {OwnIbanSuggestion[]} the one explaining most first
 */
export function ownIbanSuggestions({
	transactions,
	classifications,
	ownIbans = [],
	notOwnIbans = []
}) {
	const known = new Set([...ownIbans, ...notOwnIbans].map(compactIban).filter(Boolean));
	/** @type {Map<string, OwnIbanSuggestion>} */
	const found = new Map();
	for (const tx of transactions) {
		if (tx.deleted || Number(tx.amountCents ?? 0) <= 0) continue;
		const c = classifications[tx.id];
		if (c?.kind !== 'own-transfer' || c.via !== 'company') continue;
		const iban = compactIban(tx.counterpartyIban);
		if (!iban || known.has(iban)) continue;
		const s = found.get(iban) ?? {
			iban,
			sender: String(tx.counterparty ?? ''),
			incoming: [],
			outgoing: []
		};
		s.incoming.push(tx);
		found.set(iban, s);
	}
	if (!found.size) return [];
	for (const tx of transactions) {
		if (tx.deleted || Number(tx.amountCents ?? 0) >= 0) continue;
		const s = found.get(compactIban(tx.counterpartyIban));
		if (!s) continue;
		const covered =
			tx.receiptId || tx.noReceipt || tx.privateMistake || classifications[tx.id] != null;
		if (!covered) s.outgoing.push(tx);
	}
	return [...found.values()].sort(
		(a, b) => b.outgoing.length - a.outgoing.length || a.iban.localeCompare(b.iban)
	);
}

/**
 * The suggestion a booking belongs to: it came from the IBAN under our name,
 * or went to it.
 *
 * @param {OwnIbanSuggestion[]} suggestions
 * @param {Rec} tx
 */
export function ownIbanSuggestionFor(suggestions, tx) {
	const iban = compactIban(tx?.counterpartyIban);
	return iban ? (suggestions.find((s) => s.iban === iban) ?? null) : null;
}

/** `BE00 9999 0000 1111`: an IBAN in groups of four, to read. @param {string} iban */
export const groupIban = (iban) => compactIban(iban).replace(/(.{4})(?=.)/g, '$1 ');
