// "Alle Wallets synchronisieren": one after the other, a failure noted and
// passed, the progress as it goes, and a stop between wallets. Made-up wallets.
import { describe, expect, it } from 'vitest';

import { percentOf, syncInTurn } from './sync-turn.js';

const wallets = ['Wallet A', 'Wallet B', 'Wallet C'];

describe('syncInTurn', () => {
	it('asks every wallet in turn and adds up what they brought', async () => {
		/** @type {string[]} */
		const asked = [];
		/** @type {any[]} */
		const progress = [];
		let running = 0;
		const summary = await syncInTurn({
			wallets,
			syncOne: async (w) => {
				running += 1;
				expect(running).toBe(1);
				asked.push(w);
				await new Promise((r) => setTimeout(r, 5));
				running -= 1;
				return { new: w === 'Wallet B' ? 0 : 2, updated: 1, unpriced: w === 'Wallet C' ? 3 : 0 };
			},
			countsOf: (r) => r,
			onProgress: (p) => progress.push({ ...p })
		});
		expect(asked).toEqual(wallets);
		expect(summary).toEqual({
			wallets: 3,
			newEntries: 4,
			updated: 3,
			unpriced: 3,
			failed: 0,
			withNew: 2
		});
		expect(progress.map((p) => `${p.done}/${p.count}:${p.current ?? '-'}`)).toEqual([
			'0/3:Wallet A',
			'1/3:Wallet B',
			'2/3:Wallet C',
			'3/3:-'
		]);
	});

	it('notes a wallet that fails and goes on to the next', async () => {
		const summary = await syncInTurn({
			wallets,
			syncOne: async (w) => {
				if (w === 'Wallet A') throw new Error('the node did not answer');
				return { new: 1, updated: 0, unpriced: 0 };
			},
			countsOf: (r) => r
		});
		expect(summary.failed).toBe(1);
		expect(summary.newEntries).toBe(2);
		expect(summary.wallets).toBe(3);
	});

	it('stops between wallets when asked to', async () => {
		let n = 0;
		const summary = await syncInTurn({
			wallets,
			syncOne: async () => ({ new: 0, updated: 0, unpriced: 0 }),
			countsOf: (r) => r,
			stopped: () => n++ >= 1
		});
		expect(summary.wallets).toBe(1);
	});
});

describe('percentOf', () => {
	it('rounds the share of wallets done; none or nothing to do is 0', () => {
		expect(percentOf({ done: 1, count: 3 })).toBe(33);
		expect(percentOf({ done: 3, count: 3 })).toBe(100);
		expect(percentOf({ done: 0, count: 0 })).toBe(0);
		expect(percentOf(null)).toBe(0);
	});
});
