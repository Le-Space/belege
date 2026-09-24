// The dedup fingerprint, the same as the bridge computes for Hibiscus
// (bridge/src/normalize.js): SHA-256 over account, booking date, amount,
// purpose and counterparty, with whitespace collapsed and case folded in the
// two texts. Both sides are pinned to one known value in their tests.

/** @param {unknown} s */
function canonical(s) {
	return String(s ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * @param {{ account: string, date: string | null, amountCents: number, purpose?: string, counterpartyName?: string }} tx
 * @returns {Promise<string>} `fp1:<hex>`
 */
export async function fingerprint({ account, date, amountCents, purpose, counterpartyName }) {
	const input = [
		'v1',
		account,
		date ?? '',
		String(amountCents),
		canonical(purpose),
		canonical(counterpartyName)
	].join('\u001f');
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
	return `fp1:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A stable, non-reversible key for an IBAN (the app keeps only the last four
 * digits in the clear, and even those only inside the sealed store).
 *
 * @param {string} iban
 */
export async function ibanKey(iban) {
	const compact = String(iban ?? '')
		.replace(/\s/g, '')
		.toUpperCase();
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`belege/iban/v1:${compact}`)
	);
	return `iban-sha256:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
