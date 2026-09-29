import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PAUSE_KEY, networkPause, setNetworkPause } from './network-pause.js';

/** @type {Map<string, string>} */
let kept;
beforeEach(() => {
	kept = new Map();
	/** @type {any} */ (globalThis).localStorage = {
		getItem: (/** @type {string} */ k) => kept.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => kept.set(k, String(v)),
		removeItem: (/** @type {string} */ k) => kept.delete(k)
	};
});
afterEach(() => {
	delete (/** @type {any} */ (globalThis).localStorage);
});

describe('the network pause, per browser', () => {
	it('kept with whether the invoicing app was on; gone when resumed', () => {
		expect(networkPause()).toBeNull();
		setNetworkPause({ ucep: true }, () => new Date('2026-09-29T10:00:00Z'));
		expect(networkPause()).toEqual({ ucep: true, at: '2026-09-29T10:00:00.000Z' });
		setNetworkPause(null);
		expect(networkPause()).toBeNull();
		expect(kept.has(PAUSE_KEY)).toBe(false);
	});

	it('garbage in the store is no pause', () => {
		kept.set(PAUSE_KEY, '{not json');
		expect(networkPause()).toBeNull();
	});
});
