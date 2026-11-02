// The unlock's progress (#283 follow-up): every step reaches the screen at
// once, a move's count at most every so often, and the console gets each
// step's time and the total – nothing from the books.
import { describe, expect, it } from 'vitest';

import { createUnlockProgress } from './unlock-progress.js';

describe('the unlock progress', () => {
	it('shows each step, the count of a move throttled, and times them in the console', () => {
		let clock = 1000;
		/** @type {any[]} */
		const shown = [];
		/** @type {string[]} */
		const lines = [];
		const p = createUnlockProgress({
			onChange: (s) => shown.push(s),
			log: (l) => lines.push(l),
			now: () => clock,
			every: 100
		});
		p.status({ step: 'keys' });
		clock += 400;
		p.status({ step: 'open', collection: 'receipts' });
		clock += 2000;
		for (let i = 1; i <= 50; i++) {
			p.status({ step: 'move', collection: 'receipts', done: i, total: 50 });
			clock += 10;
		}
		p.status({ step: 'books' });
		clock += 500;
		p.finish();

		const moves = shown.filter((s) => s.step === 'move');
		// The first, one every 100 ms (10 per 100 ms reported), and the last.
		expect(moves[0].done).toBe(1);
		expect(moves.at(-1).done).toBe(50);
		expect(moves.length).toBeLessThan(10);
		expect(shown.every((s) => s.since === 1000)).toBe(true);
		expect(lines).toEqual([
			'unlock: keys took 0.4 s',
			'unlock: open receipts took 2.0 s',
			'unlock: move receipts took 0.5 s',
			'unlock: books took 0.5 s',
			'unlock: ready after 3.4 s'
		]);
	});
});
