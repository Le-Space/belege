// Wise's statement lines (issue #218). A CAMT.053 from Wise has no
// transaction details: no counterparty, no remittance text, no references.
// What happened stands in one line of text (AddtlNtryInf) and in a
// proprietary code (BkTxCd/Prtry/Cd: `CARD-123`, `FEE-…`, `TRANSFER-…`).
// This reads the lines it knows; any other line stays plain purpose.
//
//   Card transaction of 12.34 USD issued by Example Shop
//       → the merchant as counterparty, the amount in its own currency
//   Wise Charges for: CARD-123
//       → a fee, tied to the payment it names (both share that reference)
//   Topped up account …     → money in from an own account: no counterparty
//   Cashback                → from Wise
//
// Pure. Used only for a statement whose servicer is Wise.

/** @param {string} servicer Acct/Svcr/FinInstnId/Nm */
export const isWise = (servicer) => /\bwise\b/i.test(servicer);

const CARD = /^Card transaction of ([\d.,]+) ([A-Z]{3}) issued by (.+)$/;
const FEE = /^Wise Charges for:\s*(\S+)/;

/**
 * @param {{ purpose: string, code: string }} entry the line and the entry's code
 * @returns {{ counterpartyName?: string, txRef?: string, bookingType?: string, original?: { amount: string, currency: string } }}
 */
export function readWiseLine({ purpose, code }) {
	const card = CARD.exec(purpose);
	if (card) {
		return {
			counterpartyName: card[3].trim(),
			original: { amount: card[1], currency: card[2] },
			// The entry's own code: the fee charged for it names it.
			...(code ? { txRef: code } : {})
		};
	}
	const fee = FEE.exec(purpose);
	if (fee) return { counterpartyName: 'Wise', bookingType: 'FEE', txRef: fee[1] };
	if (/^Cashback\b/i.test(purpose)) return { counterpartyName: 'Wise' };
	return {};
}
