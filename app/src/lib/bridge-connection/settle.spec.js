import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleThen } from './settle.js';

describe('settleThen', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('runs once after a quiet moment', () => {
		const run = vi.fn();
		const s = settleThen(run, { quiet: 1500, most: 5000 });
		s.poke();
		vi.advanceTimersByTime(1000);
		s.poke();
		vi.advanceTimersByTime(1499);
		expect(run).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('runs within the bound while changes never stop', () => {
		const run = vi.fn();
		const s = settleThen(run, { quiet: 1500, most: 5000 });
		// Two changes a second, as the vault record written back and forth.
		for (let t = 0; t < 12_000; t += 500) {
			s.poke();
			vi.advanceTimersByTime(500);
		}
		expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it('runs nothing once stopped', () => {
		const run = vi.fn();
		const s = settleThen(run);
		s.poke();
		s.stop();
		vi.advanceTimersByTime(10_000);
		expect(run).not.toHaveBeenCalled();
	});
});
