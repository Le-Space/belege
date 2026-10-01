import { describe, expect, it } from 'vitest';

import { isEthStyle, toFilecoinAddress } from './filecoin-address.js';
import { looksLikeAddress, normalizeAddress, WALLET_CHAINS } from './chains.js';

// Made-up; the bridge's test pins the same pair (bridge/test/filecoin.test.js).
const MADE = `0x${'ab'.repeat(20)}`;
const F410 = 'f410fvov2xk5lvov2xk5lvov2xk5lvov2xk5lc6wbxja';

describe('a Filecoin wallet given as 0x…', () => {
	it('is kept as its f410f form, whichever case it was typed in', () => {
		expect(toFilecoinAddress(MADE)).toBe(F410);
		expect(toFilecoinAddress(MADE.toUpperCase().replace('0X', '0x'))).toBe(F410);
		expect(normalizeAddress(WALLET_CHAINS.filecoin, ` ${MADE} `)).toBe(F410);
	});

	it('passes the first check on the Filecoin chain, and only there as Filecoin', () => {
		expect(isEthStyle(MADE)).toBe(true);
		expect(looksLikeAddress(WALLET_CHAINS.filecoin, MADE)).toBe(true);
		expect(looksLikeAddress(WALLET_CHAINS.filecoin, F410)).toBe(true);
		expect(normalizeAddress(WALLET_CHAINS.ethereum, MADE)).toBe(MADE.toLowerCase());
	});

	it('leaves other addresses as they are', () => {
		expect(toFilecoinAddress(' f01518369 ')).toBe('f01518369');
		expect(toFilecoinAddress('0x123')).toBe('0x123');
	});
});
