// Whether a wallet account's bookings add up to its balance (issue #105).
// A gap means transactions the app does not know: a node that forgot older
// blocks, tokens back from unbonding (not a transaction), vesting, or a
// token movement the reader leaves out. Pure; quantities in the smallest unit.

import { toUnits } from '../assets/quantity.js';

/**
 * @param {Record<string, any>} account a wallet account with `balance` (decimal) and `decimals`
 * @param {Record<string, any>[]} transactions all bookings
 * @returns {{ booked: bigint, balance: bigint, gap: bigint } | null} null without a balance
 */
export function balanceGap(account, transactions) {
	if (typeof account.balance !== 'string' || !Number.isInteger(account.decimals)) return null;
	let balance;
	try {
		balance = BigInt(toUnits(account.balance, account.decimals));
	} catch {
		return null;
	}
	let booked = 0n;
	for (const t of transactions) {
		if (t.deleted || t.accountId !== account.id) continue;
		if (typeof t.quantity === 'string' && /^-?\d+$/.test(t.quantity)) booked += BigInt(t.quantity);
	}
	return { booked, balance, gap: balance - booked };
}
