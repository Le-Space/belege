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
// - The whole request must fit the request limit once sealed, when it goes to
//   the bridge's own node (#969): UCEP's 64 KiB, or what the node states in
//   its manifest (#976, 1 MiB) – then up to the bridge's body limit. 600
//   accounts of a read-in chart with names of DATEV length do not fit 64 KiB.
//   So the accounts go by what this payment makes likely – those whose name
//   shares a word with the payment, then the kind of its direction (costs for
//   money out, revenue for money in), then neither (transit, private, taxes),
//   then the other kind – as many as the budget in bytes holds.

import { BRIDGE_BODY_LIMIT, DEFAULT_REQUEST_LIMIT, jsonBudget } from '../sync/bridge-limit.js';
import { chartKind, ledgerLength } from './chart.js';
import { catalogueAccount, isAccountNumber } from './skr03.js';

export const MAX_LEARNED = 80;
export const MAX_ACCOUNTS = 600;
/**
 * The JSON of the whole `booking.assist` call, before sealing, at most. Sealed
 * it grows by a third (base64) and a few dozen bytes, and UCEP takes a request
 * of 64 KiB: 44 KiB of JSON leaves room for the envelope.
 */
export const MAX_ASSIST_BYTES = 44 * 1024;
/** The bridge's body limit (sync/bridge-limit.js). */
export { BRIDGE_BODY_LIMIT };

/**
 * The JSON of the whole `booking.assist` call at most, for the request limit
 * the call goes with: MAX_ASSIST_BYTES for UCEP's 64 KiB, the same share of a
 * bigger one up to the bridge's body limit (sync/bridge-limit.js jsonBudget).
 *
 * @param {number} [requestLimit]
 */
export const maxAssistBytes = (requestLimit = DEFAULT_REQUEST_LIMIT) => jsonBudget(requestLimit);

const encoder = new TextEncoder();
/** The bytes a value takes as JSON. @param {unknown} v */
export const jsonBytes = (v) => encoder.encode(JSON.stringify(v)).length;

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
 * @param {{ number: string, name: string, kind?: string }[]} catalogue the accounts the "Konto" field offers
 * @param {{ vendor: string, account: string }[]} learned from learnedForAssist
 * @param {import('./chart.js').StoredChart | null | undefined} chart
 * @param {(vendors: string) => string} learnedName the name of a learned account outside the catalogue
 * @param {{ hints?: unknown[], income?: boolean, budget?: number }} [options]
 *   `hints`: texts of this payment; `income`: money in (else out, when given);
 *   `budget`: bytes of JSON the list may take
 * @returns {{ number: string, name: string }[]}
 */
export function accountsForAssist(catalogue, learned, chart, learnedName, options = {}) {
	const { hints = [], income, budget = Infinity } = options;
	const maxLength = chart ? ledgerLength(chart.accounts) : Infinity;
	/** @type {Map<string, string>} */
	const out = new Map();
	// `[]` and a comma per entry.
	let used = 2;
	/** @param {string} number @param {string} name */
	const add = (number, name) => {
		const size = jsonBytes({ number, name }) + 1;
		if (out.size >= MAX_ACCOUNTS || used + size > budget) return;
		out.set(number, name);
		used += size;
	};
	for (const l of learned) {
		if (out.has(l.account)) continue;
		const known = catalogueAccount(l.account, chart);
		const vendors = learned
			.filter((x) => x.account === l.account)
			.map((x) => x.vendor)
			.slice(0, 3)
			.join(', ');
		add(l.account, (known?.name ?? learnedName(vendors)).slice(0, 120));
	}
	const hintWords = new Set(hints.flatMap(words));
	const want = income === undefined ? null : income ? 'income' : 'expense';
	/** @param {{ number: string, name: string, kind?: string }} a */
	const rank = (a) => {
		if (hintWords.size && words(a.name).some((w) => hintWords.has(w))) return 0;
		if (!want) return 1;
		const kind = a.kind ?? chartKind(a.number);
		return kind === want ? 1 : kind === 'income' || kind === 'expense' ? 3 : 2;
	};
	const ranked = catalogue
		.filter((a) => a.number.length <= maxLength)
		.map((a, i) => ({ a, r: rank(a), i }))
		.sort((x, y) => x.r - y.r || x.i - y.i);
	for (const { a } of ranked) {
		if (out.size >= MAX_ACCOUNTS) break;
		if (!out.has(a.number)) add(a.number, a.name.slice(0, 120));
	}
	return [...out.entries()].map(([number, name]) => ({ number, name }));
}
