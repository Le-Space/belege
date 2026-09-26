// The other side of an exchange trade. Made-up bookings only.
import { describe, expect, it } from 'vitest';

import { formatBookingTime } from '../bank/format.js';
import { tradeArrow, tradeSides, tradeSideWhat } from './trades.js';

const eurLeg = {
	id: 'T-EUR',
	accountId: 'K-EUR',
	source: 'kraken',
	movement: 'trade',
	txRef: 'REF-1',
	amountCents: -11040,
	currency: 'EUR'
};
const usdcLeg = {
	id: 'T-USDC',
	accountId: 'K-USDC',
	source: 'kraken',
	movement: 'trade',
	txRef: 'REF-1',
	amountCents: 11040,
	currency: 'EUR',
	asset: 'USDC',
	quantity: '128000000',
	decimals: 6
};

describe('tradeSides', () => {
	it('pairs the two legs of one trade, each with the other', () => {
		const sides = tradeSides([eurLeg, usdcLeg]);
		expect(sides.get('T-EUR')?.id).toBe('T-USDC');
		expect(sides.get('T-USDC')?.id).toBe('T-EUR');
	});

	it('says what went where: → 128 USDC on the euro leg, ← 110,40 EUR on the coin leg', () => {
		expect(`${tradeArrow(eurLeg)} ${tradeSideWhat(usdcLeg)}`).toMatch(/^→ 128\sUSDC$/);
		expect(`${tradeArrow(usdcLeg)} ${tradeSideWhat(eurLeg)}`).toMatch(/^← 110,40\sEUR$/);
	});

	it('pairs nothing that is no trade, another exchange, deleted, or ambiguous', () => {
		const deposit = { ...usdcLeg, id: 'D', movement: 'transfer' };
		expect(tradeSides([eurLeg, deposit]).size).toBe(0);
		expect(tradeSides([eurLeg, { ...usdcLeg, source: 'other' }]).size).toBe(0);
		expect(tradeSides([eurLeg, { ...usdcLeg, deleted: true }]).size).toBe(0);
		const twin = { ...usdcLeg, id: 'T-USDC-2', accountId: 'K-USDC-2' };
		expect(tradeSides([eurLeg, usdcLeg, twin]).has('T-EUR')).toBe(false);
	});
});

describe('formatBookingTime', () => {
	it('German time; the day too when it differs from the booking day; nothing without a time', () => {
		expect(formatBookingTime({ bookedOn: '2026-08-30', bookedAt: '2026-08-30T12:32:00Z' })).toBe(
			'14:32'
		);
		expect(formatBookingTime({ bookedOn: '2026-08-30', bookedAt: '2026-08-30T23:15:00Z' })).toBe(
			'31.08. 01:15'
		);
		expect(formatBookingTime({ bookedOn: '2026-08-30' })).toBe('');
	});
});
