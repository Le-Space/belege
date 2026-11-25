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

	it('24 decimals (NEAR): exact to the last yoctoNEAR, no float in between (#1028)', () => {
		const near = { id: 'acc-near', balance: '1.233124140935394189012343', decimals: 24 };
		const n = (/** @type {string} */ quantity) => ({ accountId: 'acc-near', quantity });
		// a receipt, two token transfers' gas and the 1 yoctoNEAR each attached
		const txs = [
			n('1234567890123456789012345'),
			n('-721874594031300000000'),
			n('-1'),
			n('-721874594031300000000'),
			n('-1')
		];
		expect(balanceGap(near, txs)?.gap).toBe(0n);
		// without the two security deposits, two yoctoNEAR are missing
		expect(
			balanceGap(
				near,
				txs.filter((x) => x.quantity !== '-1')
			)?.gap
		).toBe(-2n);
	});

	it('nothing to say without a balance', () => {
		expect(balanceGap({ id: 'x' }, [])).toBeNull();
	});
});
