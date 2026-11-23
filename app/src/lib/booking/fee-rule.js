// "Für alle Netzwerkgebühren übernehmen" (issue #305): a wallet's network
// fees are many and tiny – a cent for every transaction it sends – and each
// waited for its account to be confirmed one by one. One confirmation sets a
// standing rule instead: the account goes on every network fee not confirmed
// yet, now and after every matching run (session.svelte.js), marked
// `booking.via: 'rule'`. Lifting the rule takes the account off those again;
// a fee confirmed by hand keeps its own.
//
// A cost of a swap made in a transaction of its own (a NEAR storage deposit,
// `partOf` the swap's hash, #968) takes the account its swap's gas has, before
// the rule, marked `booking.via: 'swap'`, and follows it when it changes. So
// does a storage deposit for a transfer (`enables`) with the transfer's gas;
// one for a receipt has no gas of the wallet's to follow and takes the rule's.

import { recordEvent } from '../activity/events.js';
import { cleanMatchingSettings } from '../matching/classify.js';
import { getSetting, setSetting } from '../store/settings.js';
import { walletChain } from '../wallets/chains.js';
import { isAccountNumber } from './skr03.js';
import { isBookingConfirmed } from './suggest.js';

/** @typedef {Record<string, any>} Rec */

/** A wallet's network fee: what the chain charged for a transaction. @param {Rec} tx */
export const isNetworkFee = (tx) =>
	!tx?.deleted && tx?.movement === 'fee' && Boolean(walletChain(tx?.source));

/**
 * The rule's account on every network fee not confirmed yet; a swap's cost
 * made in a transaction of its own takes its gas's account first.
 *
 * @param {{ transactions: any, settings: any, events: any }} store
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<number>} bookings confirmed
 */
export async function applyFeeRule(store, { now = () => new Date() } = {}) {
	const at = now().toISOString();
	const followed = await followSwapGas(store, at);
	const { networkFeeAccount: account } = cleanMatchingSettings(
		await getSetting(store.settings, 'matching')
	);
	if (!account) return followed;
	const open = await store.transactions.list({
		where: (/** @type {Rec} */ t) => isNetworkFee(t) && !isBookingConfirmed(t)
	});
	for (const tx of open) {
		await store.transactions.put({
			...tx,
			booking: { account, taxKey: '', confirmedAt: at, via: 'rule' }
		});
	}
	if (open.length) {
		await recordEvent(store.events, 'decision', {
			action: 'fee-rule-applied',
			transactionId: open[0].id,
			count: open.length
		});
	}
	return followed + open.length;
}

/**
 * A swap's costs made in a transaction of their own (`partOf`, #968) take the
 * account of the swap's gas – where it has one confirmed – unless a person
 * confirmed them otherwise (the rule's account gives way to the gas's);
 * when the gas has none any more, they lose what they took from it.
 *
 * @param {{ transactions: any }} store
 * @param {string} at
 * @returns {Promise<number>} bookings changed
 */
async function followSwapGas(store, at) {
	const costs = await store.transactions.list({
		where: (/** @type {Rec} */ t) =>
			isNetworkFee(t) &&
			typeof costOf(t) === 'string' &&
			(!isBookingConfirmed(t) || t.booking?.via === 'swap' || t.booking?.via === 'rule')
	});
	if (!costs.length) return 0;
	const wanted = new Set(costs.map((/** @type {Rec} */ t) => `${t.source}|${costOf(t)}:fee`));
	/** @type {Map<string, Rec>} */
	const gasOf = new Map();
	for (const g of await store.transactions.list({
		where: (/** @type {Rec} */ t) =>
			isNetworkFee(t) && wanted.has(`${t.source}|${t.sourceId}`) && isBookingConfirmed(t)
	}))
		gasOf.set(`${g.source}|${g.sourceId}`, g);
	let changed = 0;
	for (const tx of costs) {
		const gas = gasOf.get(`${tx.source}|${costOf(tx)}:fee`);
		if (!gas) {
			if (tx.booking?.via !== 'swap') continue;
			await store.transactions.put({ ...tx, booking: null });
			changed++;
			continue;
		}
		const taxKey = String(gas.booking.taxKey ?? '');
		if (tx.booking?.account === gas.booking.account && tx.booking?.taxKey === taxKey) continue;
		await store.transactions.put({
			...tx,
			booking: { account: String(gas.booking.account), taxKey, confirmedAt: at, via: 'swap' }
		});
		changed++;
	}
	return changed;
}

/** The transaction a cost made apart belongs to: a swap's, or a transfer's or receipt's. @param {Rec} t */
const costOf = (t) => (typeof t.partOf === 'string' ? t.partOf : t.enables);

/**
 * Set the rule (an account) or lift it (null).
 *
 * @param {{ transactions: any, settings: any, events: any }} store
 * @param {string | null} account
 * @returns {Promise<number>} bookings confirmed, or taken off when lifted
 */
export async function setFeeRule(store, account) {
	const number = account === null ? '' : String(account).trim();
	if (number && !isAccountNumber(number)) throw new Error(`Not an account: ${number}`);
	const current = (await getSetting(store.settings, 'matching')) ?? {};
	await setSetting(store.settings, 'matching', { ...current, networkFeeAccount: number });
	await recordEvent(store.events, 'decision', {
		action: number ? 'fee-rule-set' : 'fee-rule-lifted',
		account: number
	});
	if (number) return applyFeeRule(store);
	const byRule = await store.transactions.list({
		where: (/** @type {Rec} */ t) => isNetworkFee(t) && t.booking?.via === 'rule'
	});
	for (const tx of byRule) await store.transactions.put({ ...tx, booking: null });
	// A swap's cost that followed its gas's rule account loses it too.
	await followSwapGas(store, new Date().toISOString());
	return byRule.length;
}
