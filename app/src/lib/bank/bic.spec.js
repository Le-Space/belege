// Which bank a BIC stands for: only where the BIC says so by itself.
import { describe, expect, it } from 'vitest';

import { bankOfBic } from './bic.js';

describe('the bank of a BIC', () => {
	it('knows a bank by its full BIC or its own institution code', () => {
		expect(bankOfBic('GENODEM1GLS')).toBe('GLS Bank');
		expect(bankOfBic('revolt21')).toBe('Revolut');
		expect(bankOfBic('REVO DE B2')).toBe('Revolut');
		expect(bankOfBic('TRWIBEB1XXX')).toBe('Wise');
		expect(bankOfBic('COBADEHDXXX')).toBe('comdirect');
		expect(bankOfBic('COBADEFFXXX')).toBe('Commerzbank');
	});

	it('names no bank for a code many banks share, or for what is no BIC', () => {
		// Cooperative banks and savings banks: the institution code alone says nothing.
		expect(bankOfBic('GENODEF1XYZ')).toBe('');
		expect(bankOfBic('WELADE8LXXX')).toBe('');
		expect(bankOfBic('')).toBe('');
		expect(bankOfBic(undefined)).toBe('');
		expect(bankOfBic('GLS')).toBe('');
	});
});
