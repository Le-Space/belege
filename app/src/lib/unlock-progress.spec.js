// The unlock's progress (#283 follow-up): every step reaches the screen at
// once, a move's count at most every so often, and the console gets each
// step's time and the total – nothing from the books.
import { describe, expect, it } from 'vitest';

import { createUnlockProgress, stallAfterOf } from './unlock-progress.js';

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

	it('names the part of the network step, on the screen and in the console (#803)', () => {
		let clock = 0;
		/** @type {any[]} */
		const shown = [];
		/** @type {string[]} */
		const lines = [];
		const p = createUnlockProgress({
			onChange: (s) => shown.push(s),
			log: (l) => lines.push(l),
			now: () => clock,
			setTimer: () => 1,
			clearTimer: () => {}
		});
		p.status({ step: 'network', part: 'storage' });
		clock += 300;
		p.status({ step: 'network', part: 'node' });
		clock += 200;
		p.finish();
		expect(shown.map((s) => [s.part, s.stepSince])).toEqual([
			['storage', 0],
			['node', 300]
		]);
		expect(lines).toEqual([
			'unlock: network storage took 0.3 s',
			'unlock: network node took 0.2 s',
			'unlock: ready after 0.5 s'
		]);
	});

	it('warns once in the console when a step still waits, and not after it ended', () => {
		let clock = 0;
		/** @type {{ f: () => void, ms: number, cleared: boolean }[]} */
		const timers = [];
		/** @type {string[]} */
		const lines = [];
		const p = createUnlockProgress({
			onChange: () => {},
			log: (l) => lines.push(l),
			now: () => clock,
			setTimer: (f, ms) => timers.push({ f, ms, cleared: false }) - 1,
			clearTimer: (id) => (timers[id].cleared = true)
		});
		p.status({ step: 'network', part: 'storage' });
		expect(timers[0].ms).toBe(60_000);
		clock += 60_000;
		timers[0].f();
		expect(lines).toEqual(['unlock: network storage still waiting after 60.0 s']);
		p.status({ step: 'identity' });
		p.status({ step: 'move', collection: 'receipts', done: 1, total: 2 });
		// The step that ended has its timer cleared; a move gets none.
		expect(timers[1].cleared).toBe(true);
		expect(timers).toHaveLength(2);
	});

	it('gives the long steps more time and a move all it needs', () => {
		expect(stallAfterOf({ step: 'network' })).toBe(60_000);
		expect(stallAfterOf({ step: 'open' })).toBe(300_000);
		expect(stallAfterOf({ step: 'books' })).toBe(300_000);
		expect(stallAfterOf({ step: 'move' })).toBe(Infinity);
	});
});
