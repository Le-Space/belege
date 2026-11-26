// The consumption Eigenbelege of a month's close (#1034): which accounts with
// a prepaid balance – Aleph credits, a balance in Filecoin Pay, an Akash
// wallet's deployments – get their monthly Eigenbeleg at the export, which
// already have one, and which must wait. Pure; reading the month from the
// bridge and making the documents is consumption-run.js.
//
// What gets one comes from @le-space/eigenbeleg (`needsEigenbeleg`): only
// consumption, where nobody invoices it. Fees, rewards, swaps, deposits and
// own transfers stay covered by the account statement (statement.js), as
// before. The document is the one the cards make (aleph.js, akash/statement.js,
// filecoin-pay.js): the same function, the same number range, the same
// `sourceRef` – so whichever comes first, the card's button or the export, the
// other finds it and makes none.
//
// When:
//   - only for a month that is over (`monthOver`): a running month may still
//     get bookings, rates and usage
//   - not while a wallet of the account shows a balance gap (wallets/balance-check.js):
//     the bookings are not complete, and a document made now would freeze that
//   - only after the person confirmed the list on the export page
// Once made, kept: a second export reuses it. It is linked to the month's
// top-ups of the account (an Aleph purchase, a deposit into or withdrawal from
// Filecoin Pay, an Akash wallet's network fees), which then carry its number
// in Belegfeld 1. Which bookings it was linked to is kept on the receipt
// (`selfReceipt.consumption.bookings`); when they no longer match the month,
// the export page says so and changes nothing (the card corrects it).

import { monthOver } from '@le-space/eigenbeleg/needs';
import { findStatement } from '../aleph/aleph.js';
import { findAkashStatement } from '../akash/statement.js';
import { findFilecoinPayStatement } from '../filecoin-pay/filecoin-pay.js';
import { isActive } from '../matching/engine.js';
import { balanceGap } from '../wallets/balance-check.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {'aleph' | 'filecoin-pay' | 'akash'} ConsumptionChain */

/**
 * @typedef {object} ConsumptionSource an account whose consumption gets a monthly Eigenbeleg
 * @property {ConsumptionChain} chain
 * @property {string} address as the card asks the bridge with it
 * @property {string[]} addresses every form of the address the books may hold (0x…, f410f…)
 * @property {string} name the person's name for it, '' when none
 * @property {Rec | null} wallet the own wallet (settings `wallets`), when it is one
 */

/**
 * @typedef {'create' | 'reuse' | 'changed' | 'gap' | 'open'} ConsumptionStatus
 *   create: to be made at this export; reuse: made before, kept; changed: made before, but the
 *   month's bookings are no longer those it was linked to; gap: a wallet's balance differs from
 *   its bookings; open: the month is not over
 */

/**
 * @typedef {object} ConsumptionItem
 * @property {ConsumptionSource} source
 * @property {ConsumptionStatus} status
 * @property {Rec | null} existing the Eigenbeleg made before
 * @property {Rec[]} bookings the month's top-ups it covers (not linked to another receipt)
 * @property {Rec[]} toLink of them, those not linked to it yet
 * @property {Rec[]} gaps the wallet's accounts whose balance differs from the bookings
 */

/** The kind of the receipt each card makes. */
export const CONSUMPTION_RECEIPT_KINDS = Object.freeze({
	aleph: 'aleph-statement',
	'filecoin-pay': 'filecoin-pay-statement',
	akash: 'akash-statement'
});

/** Where each kind keeps its numbers on the receipt. @type {Record<string, string>} */
const KEPT = { aleph: 'aleph', 'filecoin-pay': 'filecoinPay', akash: 'akash' };

/**
 * A card's monthly Eigenbeleg: its chain and month, or null for any other receipt.
 *
 * @param {Rec} r
 * @returns {{ chain: ConsumptionChain, month: string } | null}
 */
export function consumptionReceipt(r) {
	const kind = r?.selfReceipt?.kind;
	for (const [chain, k] of Object.entries(CONSUMPTION_RECEIPT_KINDS)) {
		if (kind !== k) continue;
		const month = r.selfReceipt?.[KEPT[chain]]?.month;
		return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month)
			? { chain: /** @type {ConsumptionChain} */ (chain), month }
			: null;
	}
	return null;
}

/** @param {unknown} a */
const lower = (a) => String(a ?? '').toLowerCase();

/**
 * The accounts of the books whose consumption gets an Eigenbeleg: the Aleph
 * accounts the Aleph card found or was given, the Filecoin Pay payers its card
 * found, and every Akash wallet.
 *
 * @param {object} p
 * @param {{ accounts?: { address: string }[], extra?: string[], names?: Record<string, string> } | null} [p.aleph]
 * @param {{ accounts?: { address: string }[] } | null} [p.filecoinPay]
 * @param {Rec[]} [p.wallets] settings `wallets`
 * @returns {ConsumptionSource[]}
 */
export function consumptionSources({ aleph = null, filecoinPay = null, wallets = [] }) {
	const walletOf = (/** @type {string[]} */ addresses) =>
		wallets.find((w) => addresses.includes(lower(w.address))) ?? null;
	/** @type {ConsumptionSource[]} */
	const out = [];
	const alephAddresses = [
		...new Set(
			[...(aleph?.accounts ?? []).map((a) => a.address), ...(aleph?.extra ?? [])].map(lower)
		)
	].filter(Boolean);
	for (const address of alephAddresses) {
		const wallet = walletOf([address]);
		out.push({
			chain: 'aleph',
			address,
			addresses: [address],
			name: wallet?.name || aleph?.names?.[address] || '',
			wallet
		});
	}
	for (const a of filecoinPay?.accounts ?? []) {
		if (!a?.address) continue;
		const wallet = walletOf([lower(a.address)]);
		out.push({
			chain: 'filecoin-pay',
			address: a.address,
			addresses: [lower(a.address), ...(wallet ? [lower(wallet.address)] : [])],
			name: wallet?.name ?? '',
			wallet
		});
	}
	for (const w of wallets.filter((w) => w.chain === 'akash')) {
		out.push({
			chain: 'akash',
			address: w.address,
			addresses: [lower(w.address)],
			name: w.name ?? '',
			wallet: w
		});
	}
	return out;
}

/**
 * The Eigenbeleg a card made for this account and month, when there is one.
 *
 * @param {Rec[]} receipts
 * @param {ConsumptionSource} source
 * @param {string} month
 */
export function existingConsumption(receipts, source, month) {
	if (source.chain === 'aleph') return findStatement(receipts, source.address, month);
	if (source.chain === 'akash') return findAkashStatement(receipts, source.address, month);
	for (const a of source.addresses) {
		const found = findFilecoinPayStatement(receipts, a, month);
		if (found) return found;
	}
	return null;
}

/**
 * The month's top-ups an account's Eigenbeleg covers: what its card lists
 * besides the usage, and the bookings that carry its number. Aleph: the
 * payments of credit purchases for this account (classify.js `aleph-purchase`);
 * Filecoin Pay: what the wallet paid into or took out of the contract
 * (`payment-contract`); Akash: the wallet's network fees, as its card links them.
 *
 * @param {object} p
 * @param {ConsumptionSource} p.source
 * @param {string} p.month
 * @param {Rec[]} p.transactions
 * @param {Rec[]} p.accounts
 * @param {Record<string, any>} p.classifications
 */
export function consumptionBookings({ source, month, transactions, accounts, classifications }) {
	const own = new Set(
		accounts
			.filter((a) => source.addresses.includes(lower(a.walletAddress)))
			.map((a) => String(a.id))
	);
	return transactions.filter((tx) => {
		if (tx.deleted || !String(tx.bookedOn ?? '').startsWith(month)) return false;
		const c = classifications[tx.id];
		if (source.chain === 'aleph')
			return (
				c?.kind === 'prepaid-topup' &&
				c.via === 'aleph-purchase' &&
				source.addresses.includes(lower(c.address))
			);
		if (!own.has(String(tx.accountId))) return false;
		if (source.chain === 'filecoin-pay') return c?.via === 'payment-contract';
		return tx.movement === 'fee';
	});
}

/**
 * The wallet's asset accounts whose balance differs from their bookings.
 *
 * @param {ConsumptionSource} source
 * @param {Rec[]} accounts
 * @param {Rec[]} transactions
 */
export function consumptionGaps(source, accounts, transactions) {
	return accounts.filter((a) => {
		if (a.deleted || !source.addresses.includes(lower(a.walletAddress))) return false;
		const g = balanceGap(a, transactions);
		return Boolean(g && g.gap !== 0n);
	});
}

/** @param {string[]} a @param {string[]} b */
const sameIds = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Every consumption account's state for a month's export.
 *
 * @param {object} p
 * @param {string} p.month YYYY-MM
 * @param {string} p.today YYYY-MM-DD
 * @param {ConsumptionSource[]} p.sources
 * @param {Rec[]} p.accounts
 * @param {Rec[]} p.transactions
 * @param {Rec[]} p.receipts
 * @param {Rec[]} p.matches
 * @param {Record<string, any>} p.classifications
 * @returns {ConsumptionItem[]}
 */
export function planConsumption({
	month,
	today,
	sources,
	accounts,
	transactions,
	receipts,
	matches,
	classifications
}) {
	const over = monthOver(month, today);
	const active = matches.filter((m) => isActive(m));
	return sources.map((source) => {
		const existing = existingConsumption(receipts, source, month);
		const linkedTo = (/** @type {Rec} */ tx) =>
			active.filter((m) => m.transactionId === tx.id).map((m) => m.receiptId);
		// Not a booking that has a receipt of its own (an invoice): that one stays.
		const bookings = consumptionBookings({
			source,
			month,
			transactions,
			accounts,
			classifications
		}).filter((tx) => linkedTo(tx).every((id) => existing && id === existing.id));
		const toLink = existing
			? bookings.filter((tx) => !linkedTo(tx).includes(existing.id))
			: bookings;
		const gaps = consumptionGaps(source, accounts, transactions);
		const kept = existing?.selfReceipt?.consumption?.bookings;
		/** @type {ConsumptionStatus} */
		const status = existing
			? Array.isArray(kept) &&
				!sameIds(
					kept.map(String),
					bookings.map((tx) => String(tx.id))
				)
				? 'changed'
				: 'reuse'
			: !over
				? 'open'
				: gaps.length
					? 'gap'
					: 'create';
		return { source, status, existing, bookings, toLink, gaps };
	});
}
