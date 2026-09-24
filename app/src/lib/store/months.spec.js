import { describe, expect, it } from 'vitest';

import { formatCents, groupByMonth } from './months.js';
import { ulid, isUlid } from './ids.js';

describe('groupByMonth', () => {
	it('groups by booking month, newest month and booking first', () => {
		const groups = groupByMonth([
			{ id: 'A', bookedOn: '2026-07-30' },
			{ id: 'B', bookedOn: '2026-08-02' },
			{ id: 'C', bookedOn: '2026-08-22' }
		]);

		expect(groups.map((g) => g.month)).toEqual(['2026-08', '2026-07']);
		expect(groups[0].label).toBe('August 2026');
		expect(groups[0].items.map((t) => t.id)).toEqual(['C', 'B']);
	});

	it('formats cents as euros, German style', () => {
		expect(formatCents(-5259).replace(/\s/g, ' ')).toBe('-52,59 €');
	});
});

describe('ulid', () => {
	it('is 26 Crockford characters and sorts by time', () => {
		const earlier = ulid(1_700_000_000_000);
		const later = ulid(1_700_000_000_001);

		expect(isUlid(earlier)).toBe(true);
		expect(earlier < later).toBe(true);
	});

	it('encodes the timestamp as the spec says', () => {
		// From the ULID spec's own example: 1469918176385 → 01ARYZ6S41.
		expect(ulid(1469918176385).slice(0, 10)).toBe('01ARYZ6S41');
	});
});
