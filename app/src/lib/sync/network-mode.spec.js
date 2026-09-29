import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	NETWORK_MODE_KEY,
	isNetworkMode,
	modeOfSetting,
	networkMode,
	setNetworkModeMirror
} from './network-mode.js';

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

describe('where own devices meet (#148)', () => {
	it('is public until this browser keeps another mode', () => {
		expect(networkMode()).toBe('public');
		setNetworkModeMirror('qr');
		expect(networkMode()).toBe('qr');
		// Something this build does not know counts as public.
		kept.set(NETWORK_MODE_KEY, 'lan');
		expect(networkMode()).toBe('public');
	});

	it('reads a stored setting only when it names a mode this build knows', () => {
		expect(modeOfSetting({ mode: 'qr' })).toBe('qr');
		expect(modeOfSetting({ mode: 'public' })).toBe('public');
		expect(modeOfSetting({ mode: 'both' })).toBeNull();
		expect(modeOfSetting(null)).toBeNull();
		expect(isNetworkMode('qr')).toBe(true);
		expect(isNetworkMode('off')).toBe(false);
	});
});
