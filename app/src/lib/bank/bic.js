// Which bank a BIC stands for, for the banks whose BIC says so by itself: a
// direct bank or a payment institution has one BIC (or one institution code)
// for all its accounts. A savings bank or a cooperative bank shares its
// institution code with hundreds of others and is not here, except where one
// full BIC is one bank. Only what is certain; an unknown BIC names no bank.
// Used to find a bank account in the person's chart of accounts
// (booking/ledger-match.js). Pure.

/** A full BIC (the branch left off when it is XXX) → the bank. */
const BY_BIC = new Map([
	['GENODEM1GLS', 'GLS Bank'],
	['GENODEF1ETK', 'EthikBank'],
	['BYLADEM1001', 'DKB'],
	['COBADEHDXXX', 'comdirect'],
	['COBADEHD', 'comdirect']
]);

/** An institution code (the BIC's first four letters) that one bank alone uses → the bank. */
const BY_INSTITUTION = new Map([
	['REVO', 'Revolut'],
	['TRWI', 'Wise'],
	['NTSB', 'N26'],
	['QNTO', 'Qonto'],
	['BUNQ', 'bunq'],
	['HOLV', 'Holvi'],
	['TROD', 'Triodos Bank'],
	['UMWE', 'UmweltBank'],
	['SOBK', 'Solaris'],
	['INGD', 'ING'],
	['PBNK', 'Postbank'],
	['DEUT', 'Deutsche Bank'],
	['COBA', 'Commerzbank']
]);

/**
 * The bank a BIC stands for, '' when the BIC alone does not say.
 *
 * @param {unknown} bic
 * @returns {string}
 */
export function bankOfBic(bic) {
	const value = String(bic ?? '')
		.replace(/\s/g, '')
		.toUpperCase();
	if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(value)) return '';
	return (
		BY_BIC.get(value) ??
		BY_BIC.get(value.slice(0, 8)) ??
		BY_INSTITUTION.get(value.slice(0, 4)) ??
		''
	);
}
