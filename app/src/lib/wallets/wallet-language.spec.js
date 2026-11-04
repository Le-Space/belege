// What wallet sync writes into the books itself – a network fee, "sent",
// a swap's purpose – follows the app's language at the time of the import.
// Made-up assets and amounts.
import { afterEach, describe, expect, it } from 'vitest';

import { setLocale } from '../i18n/index.js';
import { describeWalletEntry, swapText } from './wallet-sync.js';

afterEach(() => setLocale('de'));

describe('wallet bookings in the app’s language', () => {
	it('names a network fee, a transfer and a reward in English', () => {
		setLocale('en');
		expect(describeWalletEntry(/** @type {any} */ ({ type: 'fee', success: true })).label).toBe(
			'Network fee'
		);
		expect(describeWalletEntry(/** @type {any} */ ({ type: 'sent' })).label).toBe('Sent');
		expect(
			describeWalletEntry(/** @type {any} */ ({ type: 'received', kind: 'reward' })).label
		).toBe('Staking reward');
	});

	it('writes a swap’s purpose with English words and numbers', () => {
		setLocale('en');
		const text = swapText(
			/** @type {any} */ ({
				gave: [{ asset: 'XYZ', amount: '30000', listed: false }],
				got: [{ asset: 'ETH', amount: '0.143', listed: true }],
				via: 'Sample Router',
				fee: { asset: 'ETH', amount: '0.001' }
			})
		);
		expect(text).toBe(
			'Swap: 30,000 XYZ (not listed) → 0.143 ETH via Sample Router · Gas 0.001 ETH'
		);
	});

	it('stays German in German', () => {
		setLocale('de');
		expect(describeWalletEntry(/** @type {any} */ ({ type: 'fee', success: true })).label).toBe(
			'Netzwerkgebühr'
		);
	});
});
