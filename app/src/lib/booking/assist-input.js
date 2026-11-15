// What "✦ Konto vorschlagen" hands the language model besides the payment: the
// accounts the books learned for vendors, and the accounts it may pick from.
// Pure, so the order and the limits can be tested.
//
// - Learned accounts of the same vendor come first: the bridge sends at most
//   80, and the one that matters must not fall off the end.
// - Every learned account is offered for picking, even when the chart that was
//   read in lacks it (an account the books already book to is a valid answer),
//   and it comes before the rest so the bridge's 600-account cap keeps it.
// - Personal accounts of a read-in chart (customers, vendors – longer numbers
//   than its ledger accounts, often with an address) are not offered.

import { ledgerLength } from './chart.js';
import { catalogueAccount, isAccountNumber } from './skr03.js';

export const MAX_LEARNED = 80;
export const MAX_ACCOUNTS = 600;

/** @param {unknown} s */
const words = (s) =>
	String(s ?? '')
		.toLowerCase()
		.split(/[^a-z0-9äöüß]+/)
		.filter((w) => w.length >= 3);

/**
 * @param {Record<string, any>[]} partners the books' partners with their learned account
 * @param {unknown[]} hints texts of this payment: counterparty, purpose, receipt vendor
 * @returns {{ vendor: string, account: string }[]}
 */
export function learnedForAssist(partners, hints) {
	const hintWords = new Set(hints.flatMap(words));
	const all = partners
		.filter((p) => isAccountNumber(p.account) && String(p.name ?? '').trim())
		.map((p) => ({ vendor: String(p.name).slice(0, 200), account: String(p.account) }));
	const close = (/** @type {{ vendor: string }} */ l) =>
		words(l.vendor).some((w) => hintWords.has(w));
	return [...all.filter(close), ...all.filter((l) => !close(l))].slice(0, MAX_LEARNED);
}

/**
 * @param {{ number: string, name: string }[]} catalogue the accounts the "Konto" field offers
 * @param {{ vendor: string, account: string }[]} learned from learnedForAssist
 * @param {import('./chart.js').StoredChart | null | undefined} chart
 * @param {(vendors: string) => string} learnedName the name of a learned account outside the catalogue
 * @returns {{ number: string, name: string }[]}
 */
export function accountsForAssist(catalogue, learned, chart, learnedName) {
	const maxLength = chart ? ledgerLength(chart.accounts) : Infinity;
	/** @type {Map<string, string>} */
	const out = new Map();
	for (const l of learned) {
		if (out.has(l.account)) continue;
		const known = catalogueAccount(l.account, chart);
		const vendors = learned
			.filter((x) => x.account === l.account)
			.map((x) => x.vendor)
			.slice(0, 3)
			.join(', ');
		out.set(l.account, (known?.name ?? learnedName(vendors)).slice(0, 120));
	}
	for (const a of catalogue) {
		if (out.size >= MAX_ACCOUNTS) break;
		if (out.has(a.number) || a.number.length > maxLength) continue;
		out.set(a.number, a.name.slice(0, 120));
	}
	return [...out.entries()].slice(0, MAX_ACCOUNTS).map(([number, name]) => ({ number, name }));
}
