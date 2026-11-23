import { describe, expect, it } from 'vitest';

import { amount } from './datev.js';
import { euro } from './pdf-format.js';

describe('euro', () => {
	it('writes cents as the DATEV amount with EUR', () => {
		expect(euro(1234)).toBe('12,34 EUR');
		expect(euro(1234)).toBe(`${amount(1234)} EUR`);
		expect(euro(-1234)).toBe(`${amount(-1234)} EUR`);
		expect(euro(0)).toBe(`${amount(0)} EUR`);
	});

	it('writes a dash for no amount', () => {
		expect(euro(null)).toBe('—');
	});
});
