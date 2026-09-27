// The AI queue: workers at once, a rate limit retried after a pause, cancel,
// locking keeps what is left, pending ids kept in the settings.
import { describe, expect, it } from 'vitest';

import { loadPending, savePending } from './pending.js';
import { runQueue } from './queue.js';

const state = () => ({ progress: null, cancelling: false, failed: 0 });
/** @param {number} status */
const httpError = (status) => Object.assign(new Error('bridge'), { status });

/** An id is released by hand: shows how many run at once. */
function gate() {
	/** @type {Map<string, () => void>} */
	const waiting = new Map();
	let most = 0;
	return {
		/** @param {string} id */
		handle: (id) =>
			new Promise((resolve) => {
				waiting.set(id, () => resolve(undefined));
				most = Math.max(most, waiting.size);
			}),
		/** @param {string} id */
		release: (id) => {
			waiting.get(id)?.();
			waiting.delete(id);
		},
		ids: () => [...waiting.keys()],
		most: () => most
	};
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('runQueue', () => {
	it('runs as many at once as asked, each id once; a second run is refused', async () => {
		const g = gate();
		const s = state();
		/** @type {string[][]} */
		const progress = [];
		const run = runQueue({
			ids: ['a', 'b', 'c', 'd'],
			state: s,
			workers: 2,
			handle: g.handle,
			onProgress: (left) => progress.push(left)
		});
		await tick();
		expect(g.ids()).toEqual(['a', 'b']);
		expect(await runQueue({ ids: ['x'], state: s, handle: g.handle })).toBe(false);
		for (const id of ['a', 'b', 'c', 'd']) {
			g.release(id);
			await tick();
			await tick();
		}
		expect(await run).toBe(true);
		expect(g.most()).toBe(2);
		expect(progress[0]).toEqual(['a', 'b', 'c', 'd']);
		expect(progress[1]).toEqual(['b', 'c', 'd']);
		expect(progress.at(-1)).toEqual([]);
		expect(s).toEqual({ progress: null, cancelling: false, failed: 0 });
	});

	it('the number of workers is kept between 1 and 4', async () => {
		for (const [asked, most] of [
			[0, 2],
			[9, 4],
			[1, 1]
		]) {
			const g = gate();
			const run = runQueue({
				ids: ['a', 'b', 'c', 'd', 'e'],
				state: state(),
				workers: asked,
				handle: g.handle
			});
			await tick();
			expect(g.ids()).toHaveLength(most);
			while (g.ids().length) {
				for (const id of g.ids()) g.release(id);
				await tick();
				await tick();
			}
			await run;
		}
	});

	it('a rate limit sends the id back and pauses, doubling; other errors fail', async () => {
		/** @type {number[]} */
		const pauses = [];
		const tries = new Map();
		const s = state();
		await runQueue({
			ids: ['a', 'b'],
			state: s,
			workers: 1,
			sleep: async (ms) => {
				pauses.push(ms);
			},
			handle: async (id) => {
				tries.set(id, (tries.get(id) ?? 0) + 1);
				if (id === 'a' && tries.get(id) < 3) throw httpError(429);
				if (id === 'b') throw httpError(502);
			}
		});
		expect(tries.get('a')).toBe(3);
		expect(s.failed).toBe(1);
		// b waits out the pause too; the second limit on a doubles it.
		expect(pauses).toEqual([2000, 2000, 4000]);
	});

	it('a rate limit that never ends fails the id after six more tries', async () => {
		const s = state();
		let calls = 0;
		await runQueue({
			ids: ['a'],
			state: s,
			sleep: async () => {},
			handle: async () => {
				calls++;
				throw httpError(429);
			}
		});
		expect(calls).toBe(7);
		expect(s.failed).toBe(1);
	});

	it('cancel ends with nothing kept; locking keeps what is left', async () => {
		const s = state();
		/** @type {any[]} */
		let end = [];
		await runQueue({
			ids: ['a', 'b', 'c'],
			state: s,
			workers: 1,
			handle: async () => {
				s.cancelling = true;
			},
			onEnd: (left, how) => {
				end = [left, how];
			}
		});
		expect(end).toEqual([['b', 'c'], 'cancelled']);

		let open = true;
		await runQueue({
			ids: ['a', 'b', 'c'],
			state: state(),
			workers: 1,
			isOpen: () => open,
			handle: async () => {
				open = false;
			},
			onEnd: (left, how) => {
				end = [left, how];
			}
		});
		expect(end).toEqual([['b', 'c'], 'closed']);
	});
});

describe('pending ids', () => {
	/** A settings collection in memory, as the store's list/put see it. */
	function memorySettings() {
		/** @type {any[]} */
		const rows = [];
		let puts = 0;
		return {
			puts: () => puts,
			list: async (/** @type {any} */ { where = () => true } = {}) => rows.filter(where),
			put: async (/** @type {any} */ r) => {
				puts++;
				const i = rows.findIndex((x) => x.key === r.key);
				if (i >= 0) rows[i] = r;
				else rows.push(r);
				return r;
			}
		};
	}

	it('each kind kept on its own; the same list is not written twice; junk is dropped', async () => {
		const settings = /** @type {any} */ (memorySettings());
		expect(await loadPending(settings)).toEqual({ extract: [], suggest: [] });
		savePending(settings, 'extract', ['r1', 'r2']);
		savePending(settings, 'suggest', ['q1']);
		await savePending(settings, 'extract', ['r2']);
		expect(await loadPending(settings)).toEqual({ extract: ['r2'], suggest: ['q1'] });
		const puts = settings.puts();
		await savePending(settings, 'extract', ['r2']);
		expect(settings.puts()).toBe(puts);
		await settings.put({ key: 'pendingJobs', value: { extract: [1, 'r9'], suggest: 'x' } });
		expect(await loadPending(settings)).toEqual({ extract: ['r9'], suggest: [] });
	});
});
