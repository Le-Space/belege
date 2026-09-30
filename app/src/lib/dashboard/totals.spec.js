import { describe, expect, it } from 'vitest';

import { flowKey, yearTotals } from './totals.js';

// Made-up bookings: a bank account, Kraken and a wallet on a Cosmos chain.
let n = 0;
/** @param {number} amountCents @param {Record<string, any>} [more] */
const tx = (amountCents, more = {}) => ({
	id: `t${++n}`,
	source: 'hibiscus',
	amountCents,
	bookedOn: '2026-05-10',
	...more
});

describe('income and expenses of a year (#194)', () => {
	it('sums what crosses to others, bank and crypto apart; fees are expenses, rewards income', () => {
		const sale = tx(250_00);
		const rent = tx(-90_00, { source: 'camt' });
		const bankFee = tx(-4_90);
		const reward = tx(12_00, { source: 'nyx', movement: 'reward' });
		const gas = tx(-1_50, { source: 'ethereum', movement: 'fee' });
		const paidInCrypto = tx(-40_00, { source: 'kraken' });
		const t = yearTotals([sale, rent, bankFee, reward, gas, paidInCrypto], {
			[bankFee.id]: { kind: 'bank-fee' },
			[reward.id]: { kind: 'crypto-reward' },
			[gas.id]: { kind: 'bank-fee' }
		});
		expect(t.bank).toEqual({ income: 250_00, expenses: 94_90 });
		expect(t.crypto).toEqual({ income: 12_00, expenses: 41_50 });
		expect(t.total).toEqual({ income: 262_00, expenses: 136_40 });
		expect(t.balance).toBe(125_60);
		expect(t.counted).toBe(6);
	});

	it('moving money between own places is neither: transfers, swaps, trades, stakes, burns, dust', () => {
		const kinds = [
			'own-transfer',
			'crypto-swap',
			'crypto-stake',
			'crypto-dust',
			'token-burn',
			'token-migration',
			'rule-ignore'
		];
		const list = kinds.map((_, i) => tx(i % 2 ? 500_00 : -500_00, { source: 'ethereum' }));
		const classes = Object.fromEntries(list.map((t, i) => [t.id, { kind: kinds[i] }]));
		// A crypto sale to euros on the exchange: both legs are a trade, a swap.
		const sold = tx(-300_00, { source: 'kraken', movement: 'trade', asset: 'ETH' });
		const euros = tx(300_00, { source: 'kraken', movement: 'trade' });
		const deleted = tx(-10_00, { deleted: true });
		const t = yearTotals([...list, sold, euros, deleted], classes);
		expect(t.total).toEqual({ income: 0, expenses: 0 });
		expect(t.counted).toBe(0);
		expect(flowKey(sold, undefined)).toBeNull();
	});

	it('a refund is netted against its charge: fully, both vanish; partly, the rest stays', () => {
		const charge = tx(-80_00);
		const back = tx(80_00);
		const full = yearTotals([charge, back], {
			[charge.id]: { kind: 'refund', role: 'charge' },
			[back.id]: { kind: 'refund', role: 'refund' }
		});
		expect(full.bank).toEqual({ income: 0, expenses: 0 });

		const big = tx(-100_00);
		const part = tx(30_00);
		// After a partial refund only the refund is classified; the charge still needs its receipt.
		const partial = yearTotals([big, part], { [part.id]: { kind: 'refund', role: 'refund' } });
		expect(partial.bank).toEqual({ income: 0, expenses: 70_00 });

		// A refund we paid lowers the income it undoes.
		const income = tx(200_00);
		const weRefund = tx(-50_00);
		const ours = yearTotals([income, weRefund], {
			[weRefund.id]: { kind: 'refund', role: 'refund' }
		});
		expect(ours.bank).toEqual({ income: 150_00, expenses: 0 });
	});

	it('private payments and loans get a line of their own, not the four sums', () => {
		const privatePaid = tx(-60_00, { privateMistake: { note: 'x' } });
		const repaid = tx(60_00, { privateRepaymentOf: [privatePaid.id] });
		const byRule = tx(-15_00);
		const loanIn = tx(1000_00);
		const loanBack = tx(-200_00);
		const t = yearTotals([privatePaid, repaid, byRule, loanIn, loanBack], {
			[byRule.id]: { kind: 'rule-private' },
			[loanIn.id]: { kind: 'loan' },
			[loanBack.id]: { kind: 'loan' }
		});
		expect(t.total).toEqual({ income: 0, expenses: 0 });
		expect(t.private).toEqual({ paid: 75_00, repaid: 60_00, count: 3 });
		expect(t.loans).toEqual({ received: 1000_00, paid: 200_00, count: 2 });
		expect(flowKey(privatePaid, undefined)).toBe('private');
		expect(flowKey(loanIn, { kind: 'loan' })).toBe('loan');
	});

	it('a crypto booking without a rate is counted, not summed', () => {
		const unpriced = tx(0, { source: 'ethereum', rateMissing: { reason: 'x' }, quantity: '5' });
		const priced = tx(-20_00, { source: 'ethereum' });
		const t = yearTotals([unpriced, priced], {});
		expect(t.unpriced).toBe(1);
		expect(t.crypto).toEqual({ income: 0, expenses: 20_00 });
		expect(flowKey(unpriced, undefined)).toBe('unpriced');
		expect(flowKey(priced, undefined)).toBe('crypto-expenses');
		expect(flowKey(tx(5_00), undefined)).toBe('bank-income');
	});
});
