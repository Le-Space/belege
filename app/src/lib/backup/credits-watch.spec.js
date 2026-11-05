// How long the credits keep the backups: what the header warns about.
import { describe, expect, it } from 'vitest';

import { daysLeft } from './credits-watch.js';
import { creditsPerDay } from './keeper.js';

describe('days the credits keep the backups', () => {
	it('is the credits over what the kept backups cost a day', () => {
		const bytes = 722 * 1048576;
		expect(daysLeft({ credits: creditsPerDay(bytes) * 4, bytes })).toBeCloseTo(4);
	});

	it('cannot be told without credits or without backups', () => {
		expect(daysLeft({ credits: null, bytes: 1000 })).toBeNull();
		expect(daysLeft({ credits: 1000, bytes: 0 })).toBeNull();
	});
});
