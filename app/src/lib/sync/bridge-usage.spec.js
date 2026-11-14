// The usage a device has at the bridge (#579, item 7): command names, counts
// and times as the bridge sends them, and nothing else shown. Made up.
import { describe, expect, it } from 'vitest';

import { usageList, usageTotal } from './bridge-usage.js';

describe('a device’s usage of the bridge', () => {
	it('keeps command names with counts and a time, newest first', () => {
		const list = usageList([
			{ command: 'mail.search', calls: 3, refused: 1, lastAt: 100 },
			{ command: 'llm.extract', calls: 2, refused: 0, lastAt: 200, body: 'Wolkenfabrik' },
			{ command: '<img src=x>', calls: 1, refused: 0, lastAt: 300 },
			{ command: 'bank.accounts', calls: -4, refused: 1.5, lastAt: 'gestern' },
			null
		]);
		expect(list).toEqual([
			{ command: 'llm.extract', calls: 2, refused: 0, lastAt: 200 },
			{ command: 'mail.search', calls: 3, refused: 1, lastAt: 100 },
			{ command: 'bank.accounts', calls: 0, refused: 0, lastAt: 0 }
		]);
		expect(usageTotal(list)).toEqual({ calls: 5, refused: 1 });
	});

	it('an older bridge without usage: nothing', () => {
		expect(usageList(undefined)).toEqual([]);
		expect(usageTotal([])).toEqual({ calls: 0, refused: 0 });
	});
});
