// The balance check: made-up quantities only.
import { describe, expect, it } from 'vitest';

import { balanceGap } from './balance-check.js';

const account = { id: 'acc-akt', balance: '49.5', decimals: 6 };
/** @param {string} quantity @param {Record<string, any>} [extra] */
const t = (quantity, extra = {}) => ({ accountId: 'acc-akt', quantity, deleted: false, ...extra });

describe('balanceGap', () => {
	it('no gap when the bookings add up, fees included', () => {
		const txs = [t('50000000'), t('-495000'), t('-5000'), t('-99', { accountId: 'other' })];
		expect(balanceGap(account, txs)).toEqual({ booked: 49500000n, balance: 49500000n, gap: 0n });
	});

	it('a gap when older transactions are missing; deleted bookings do not count', () => {
		const txs = [t('1000000'), t('5000000', { deleted: true })];
		expect(balanceGap(account, txs)?.gap).toBe(48500000n);
	});

	it('nothing to say without a balance', () => {
		expect(balanceGap({ id: 'x' }, [])).toBeNull();
	});
});
