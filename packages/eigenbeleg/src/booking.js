// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbeleg of one booking, as Belege writes it: a receipt the company
// writes itself for a payment that has no receipt from the other side – a
// bank booking, or a payment on a blockchain that issues no invoices.
//
// It says what was paid, to whom (or by whom), when and how much, and why
// there is no receipt from the other side; who wrote it and when, with a line
// to sign. For a crypto payment it also carries quantity, rate with its
// source, and – for an own wallet's booking – the transaction in full: the
// whole hash, sender and receiver with their full addresses, and every
// movement of the transaction the books know, the gas included (Belege #126).
// The booking's context (its account, the address book, the other legs) is
// the caller's to gather; booking-pdf.js draws the document.
//
// The numbers are a range per year: EB-YYYY-NNN.
//
// Moved from Belege's app/src/lib/receipts/eigenbeleg.js (its types and the
// number range); the rest of that file stays in the app.

const NUMBER = /^EB-(\d{4})-(\d{3,})$/;

/**
 * The next number in the Eigenbeleg range of a year: EB-2026-001, EB-2026-002, …
 *
 * @param {{ selfNumber?: unknown }[]} receipts all of them, set aside ones too
 * @param {string} year YYYY
 */
export function nextSelfNumber(receipts, year) {
	let highest = 0;
	for (const r of receipts) {
		const m = NUMBER.exec(String(r.selfNumber ?? ''));
		if (m && m[1] === year) highest = Math.max(highest, Number(m[2]));
	}
	return `EB-${year}-${String(highest + 1).padStart(3, '0')}`;
}

/**
 * @typedef {object} Party one side of a wallet transaction
 * @property {string} label a name from the address book, '' when none
 * @property {string} address the whole address
 * @property {boolean} own an own wallet
 */

/**
 * @typedef {object} ChainDetails an own wallet's transaction, in full
 * @property {string} chain the chain's name
 * @property {string} hash the whole transaction hash, never shortened
 * @property {string} explorerUrl
 * @property {string} at ISO 8601, when the block was made ('' when not known)
 * @property {Party} from
 * @property {Party} to
 * @property {{ what: string, quantity: string, euro: string, booked: boolean }[]} movements
 *   every movement of the transaction the books know: its legs, the gas, and a
 *   swap's side that is not booked (a token not in the chain's list); quantity
 *   and euro as they are printed
 */

/**
 * @typedef {object} BookingEigenbeleg what the PDF shows
 * @property {string} number
 * @property {string} issuer our company, '' when none is set
 * @property {string} [issuerAddress] its postal address, lines separated by \n
 * @property {string} date YYYY-MM-DD, of the payment
 * @property {number} amountCents signed, from the account's view
 * @property {string} account
 * @property {string} counterparty
 * @property {string} purpose the bank's purpose, as the booking has it
 * @property {string} description what was paid for
 * @property {string} reason why there is no receipt from the other side
 * @property {string} txRef '' when none
 * @property {{ asset: string, quantity: string, decimals: number, rate: string, source: string, at: string } | null} crypto
 *   quantity in the asset's smallest unit; source as it is printed (e.g. "CoinGecko")
 * @property {ChainDetails | null} [chain] an own wallet's transaction in full
 * @property {string} createdAt ISO 8601
 * @property {string} createdBy who wrote it (a name, or the identity's DID)
 */

/** The note in the box on top. @param {boolean} onChain */
export const bookingNote = (onChain) =>
	`Eigenbeleg. Für diese Zahlung gibt es keinen Beleg der Gegenseite. Ausgestellt auf Grundlage der Buchung${
		onChain
			? ' und der öffentlichen Transaktion; sie ist über ihren Transaktions-Hash in einem öffentlichen Block-Explorer nachprüfbar.'
			: '.'
	}`;

/** What it is not, above the line to sign. @param {string} creator */
export const bookingNotInvoice = (creator) =>
	`Erstellt mit ${creator}. Ein Eigenbeleg ersetzt einen fehlenden Beleg der Gegenseite; er ist keine Rechnung und berechtigt nicht zum Vorsteuerabzug. Ob er anerkannt wird, klärt die Steuerberatung.`;
