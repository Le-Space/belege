import { describe, expect, it } from 'vitest';
import { invertRate, isWeak, perEuro } from './rate-display.js';

describe('rate display (#312)', () => {
	it('turns EUR per ruble into rubles per euro, and back', () => {
		expect(perEuro('0.010921143881')).toBe('91.5655');
		expect(invertRate('91.5655')).toBe('0.010921143881');
		expect(invertRate('0.0105')).toBe('95.238095238095');
		expect(invertRate('100')).toBe('0.01');
		expect(perEuro('0.01')).toBe('100');
	});

	it('refuses what cannot be turned', () => {
		expect(invertRate('0')).toBeNull();
		expect(invertRate('')).toBeNull();
		expect(invertRate('abc')).toBeNull();
	});

	it('calls a currency weak by its rate, or by its name before a rate is known', () => {
		expect(isWeak('RUB')).toBe(true);
		expect(isWeak('USD')).toBe(false);
		expect(isWeak('TRY', '0.026')).toBe(true);
		expect(isWeak('USD', '0.92')).toBe(false);
		expect(isWeak('RUB', '0.5')).toBe(false);
	});
});
