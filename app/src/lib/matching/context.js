// The context classification needs, built from the store's records: our
// company names and rules (settings key `matching`), and our own accounts.
//
// Our accounts' full IBANs are not kept (step 2): a CAMT account is keyed by a
// hash of its IBAN, a Hibiscus account by its last four digits. So a
// counterparty IBAN is hashed and looked up among the CAMT keys, and four
// digits count only together with the counter-booking on that account.

import { ibanKey } from '../bank/fingerprint.js';
import { cleanMatchingSettings } from './classify.js';
import { compactIban, dayNumber } from './normalize.js';
import { learnedVendors } from './partners.js';

/** A transfer between our accounts lands within this many days on the other side. */
export const MIRROR_DAYS = 4;

/**
 * @param {object} params
 * @param {Record<string, any>[]} params.accounts
 * @param {Record<string, any>[]} params.transactions
 * @param {any} params.settings the stored `matching` value, or null
 * @param {Record<string, any>[]} [params.partners] what people's links taught (partners.js)
 * @returns {Promise<import('./classify.js').ClassifyContext & { learnedVendors: Map<string, string[]> }>}
 */
export async function buildMatchingContext({ accounts, transactions, settings, partners = [] }) {
	const clean = cleanMatchingSettings(settings);
	const ownIbans = new Set(clean.ownIbans);

	const camtKeys = new Set(
		accounts
			.filter((a) => a.source === 'camt' && typeof a.sourceAccountId === 'string')
			.map((a) => a.sourceAccountId)
	);
	if (camtKeys.size) {
		const seen = new Set();
		for (const tx of transactions) {
			const iban = compactIban(tx.counterpartyIban);
			if (!iban || seen.has(iban)) continue;
			seen.add(iban);
			if (camtKeys.has(await ibanKey(iban))) ownIbans.add(iban);
		}
	}

	/** @type {Map<string, string[]>} */
	const ownLast4 = new Map();
	for (const a of accounts) {
		if (a.source !== 'hibiscus' || !/^[A-Z0-9]{4}$/i.test(String(a.ibanLast4 ?? ''))) continue;
		const key = String(a.ibanLast4).toUpperCase();
		ownLast4.set(key, [...(ownLast4.get(key) ?? []), a.id]);
	}

	/** @type {Map<string, Record<string, any>[]>} */
	const byAccount = new Map();
	for (const tx of transactions) {
		const list = byAccount.get(tx.accountId) ?? [];
		list.push(tx);
		byAccount.set(tx.accountId, list);
	}

	return {
		companyNames: clean.companyNames,
		ownIbans,
		ownLast4,
		rules: clean.rules,
		graceDays: clean.graceDays,
		feeKeys: new Set(clean.feeKeys),
		learnedVendors: learnedVendors(partners),
		mirrored(tx, accountIds) {
			const day = dayNumber(tx.bookedOn);
			if (day === null) return false;
			return accountIds.some(
				(id) =>
					id !== tx.accountId &&
					(byAccount.get(id) ?? []).some((other) => {
						const d = dayNumber(other.bookedOn);
						return (
							other.amountCents === -tx.amountCents &&
							d !== null &&
							Math.abs(d - day) <= MIRROR_DAYS
						);
					})
			);
		}
	};
}
