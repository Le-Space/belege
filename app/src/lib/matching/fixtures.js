// Synthetic records for the matching tests: the phase-0 cases
// (docs/phase-0.md, "Matching") with made-up vendors, numbers and IBANs
// (check digits 00). Nothing here comes from real data.

let n = 0;
const id = (/** @type {string} */ prefix) => `${prefix}${String(++n).padStart(4, '0')}`;

/**
 * A receipt record as it looks after "Auslesen".
 *
 * @param {Record<string, any>} x extraction fields (snake_case, as the LLM answers)
 * @param {Record<string, any>} [record] record fields
 */
export function receipt(x, record = {}) {
	const extraction = {
		document_type: 'invoice',
		vendor: 'Unbekannt',
		invoice_number: null,
		customer_number: null,
		invoice_date: null,
		due_or_debit_date: null,
		currency: 'EUR',
		gross: null,
		payment: null,
		iban_last4: null,
		...x
	};
	return {
		id: id('R'),
		source: 'mail',
		authVerdict: 'pass',
		status: 'ausgelesen',
		extraction,
		vendor: extraction.vendor,
		amountCents: extraction.gross === null ? null : Math.round(extraction.gross * 100),
		currency: extraction.currency,
		documentDate: extraction.invoice_date,
		invoiceNumber: extraction.invoice_number,
		deleted: false,
		...record
	};
}

/**
 * A transaction record as the import stores it.
 *
 * @param {Record<string, any>} t
 */
export function tx(t) {
	return {
		id: id('T'),
		accountId: 'ACC-GLS',
		source: 'hibiscus',
		currency: 'EUR',
		counterparty: '',
		counterpartyIban: '',
		purpose: '',
		endToEndId: '',
		bookingType: 'Basislastschrift',
		receiptId: null,
		deleted: false,
		...t
	};
}

/** Our own accounts, as the `accounts` collection keeps them. */
export const ACCOUNTS = [
	{
		id: 'ACC-GLS',
		source: 'hibiscus',
		sourceAccountId: '1',
		ibanLast4: '4711',
		name: 'Geschäftskonto Test'
	},
	{
		id: 'ACC-REV',
		source: 'hibiscus',
		sourceAccountId: '2',
		ibanLast4: '0001',
		name: 'Revolut Test'
	}
];
