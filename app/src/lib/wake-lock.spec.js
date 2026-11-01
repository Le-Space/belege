// The screen stays on while a long run holds it (#512): one lock for every
// holder, released with the last; taken again when the tab comes back; nothing
// where the browser has no such thing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { awakeHolders, canKeepAwake, keepAwake } from './wake-lock.js';

function fakeWakeLock() {
	/** @type {string[]} */
	const requests = [];
	/** @type {string[]} */
	const releases = [];
	const request = vi.fn(async (/** @type {string} */ kind) => {
		requests.push(kind);
		/** @type {(() => void)[]} */
		const listeners = [];
		const sentinel = {
			addEventListener: (/** @type {string} */ _e, /** @type {() => void} */ l) =>
				listeners.push(l),
			release: vi.fn(async () => {
				releases.push(kind);
				for (const l of listeners) l();
			})
		};
		return sentinel;
	});
	return { request, requests, releases };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('keepAwake', () => {
	it('is nothing where the browser cannot', () => {
		vi.stubGlobal('navigator', {});
		expect(canKeepAwake()).toBe(false);
		const release = keepAwake();
		expect(awakeHolders()).toBe(1);
		release();
		expect(awakeHolders()).toBe(0);
	});

	it('one lock for every holder, released with the last', async () => {
		const lock = fakeWakeLock();
		vi.stubGlobal('navigator', { wakeLock: lock });
		vi.stubGlobal('document', {
			visibilityState: 'visible',
			addEventListener: vi.fn(),
			removeEventListener: vi.fn()
		});
		const a = keepAwake();
		const b = keepAwake();
		await tick();
		expect(lock.requests).toEqual(['screen']);
		a();
		expect(lock.releases).toEqual([]);
		b();
		await tick();
		expect(lock.releases).toEqual(['screen']);
		expect(awakeHolders()).toBe(0);
	});

	it('takes the lock again when the tab comes back', async () => {
		const lock = fakeWakeLock();
		/** @type {Record<string, () => void>} */
		const listeners = {};
		const doc = {
			visibilityState: 'visible',
			addEventListener: (/** @type {string} */ e, /** @type {() => void} */ l) =>
				(listeners[e] = l),
			removeEventListener: vi.fn()
		};
		vi.stubGlobal('navigator', { wakeLock: lock });
		vi.stubGlobal('document', doc);
		const release = keepAwake();
		await tick();
		expect(lock.requests).toHaveLength(1);
		// The browser drops the lock as the tab goes to the background …
		doc.visibilityState = 'hidden';
		await /** @type {any} */ (await lock.request.mock.results[0].value).release();
		listeners.visibilitychange?.();
		await tick();
		expect(lock.requests).toHaveLength(1);
		// … and it is taken again when the tab is visible.
		doc.visibilityState = 'visible';
		listeners.visibilitychange?.();
		await tick();
		expect(lock.requests).toHaveLength(2);
		release();
	});
});
