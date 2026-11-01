// "Für alle Netzwerkgebühren übernehmen" (issue #305): a wallet's network
// fees are many and tiny – a cent for every transaction it sends – and each
// waited for its account to be confirmed one by one. One confirmation sets a
// standing rule instead: the account goes on every network fee not confirmed
// yet, now and after every matching run (session.svelte.js), marked
// `booking.via: 'rule'`. Lifting the rule takes the account off those again;
// a fee confirmed by hand keeps its own.

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
 * The rule's account on every network fee not confirmed yet.
 *
 * @param {{ transactions: any, settings: any, events: any }} store
 * @param {{ now?: () => Date }} [options]
 * @returns {Promise<number>} bookings confirmed
 */
export async function applyFeeRule(store, { now = () => new Date() } = {}) {
	const { networkFeeAccount: account } = cleanMatchingSettings(
		await getSetting(store.settings, 'matching')
	);
	if (!account) return 0;
	const open = await store.transactions.list({
		where: (/** @type {Rec} */ t) => isNetworkFee(t) && !isBookingConfirmed(t)
	});
	const at = now().toISOString();
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
	return open.length;
}

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
	return byRule.length;
}
