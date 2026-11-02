import { describe, expect, it } from 'vitest';

import {
	captureReturn,
	parseReturn,
	rememberStart,
	RETURN_PATH,
	takeReturn,
	takeStart
} from './return.js';

function memoryStorage() {
	/** @type {Map<string, string>} */
	const m = new Map();
	return {
		m,
		getItem: (/** @type {string} */ k) => m.get(k) ?? null,
		setItem: (/** @type {string} */ k, /** @type {string} */ v) => void m.set(k, v),
		removeItem: (/** @type {string} */ k) => void m.delete(k)
	};
}

/** @param {string} href */
function browser(href) {
	const url = new URL(href);
	/** @type {string[]} */ const replaced = [];
	return {
		replaced,
		location: { pathname: url.pathname, href },
		replace: (/** @type {string} */ to) => void replaced.push(to)
	};
}

const CODE = '0a1b2c3d-made-up-code';
const STATE = '11111111-2222-4333-8444-555555555555';

describe('the bank’s answer leaves the address at once (#224)', () => {
	it('moves code and state into this tab’s storage, and the address keeps only the path', () => {
		const storage = memoryStorage();
		const b = browser(`https://belege.example${RETURN_PATH}?code=${CODE}&state=${STATE}`);
		expect(captureReturn({ ...b, storage })).toBe(true);
		expect(b.replaced).toEqual([RETURN_PATH]);
		expect(takeReturn(storage)).toEqual({
			code: CODE,
			state: STATE,
			error: null,
			errorDescription: null
		});
		expect(takeReturn(storage)).toBeNull();
	});

	it('keeps a refusal with the bank’s words', () => {
		const storage = memoryStorage();
		const b = browser(
			`https://belege.example${RETURN_PATH}/?error=access_denied&error_description=Abgebrochen&state=${STATE}`
		);
		expect(captureReturn({ ...b, storage })).toBe(true);
		expect(takeReturn(storage)).toMatchObject({
			code: null,
			error: 'access_denied',
			errorDescription: 'Abgebrochen'
		});
	});

	it('leaves every other page and an address without an answer alone', () => {
		const storage = memoryStorage();
		for (const href of [
			`https://belege.example/integrationen/bank?code=${CODE}&state=${STATE}`,
			`https://belege.example${RETURN_PATH}`
		]) {
			const b = browser(href);
			expect(captureReturn({ ...b, storage })).toBe(false);
			expect(b.replaced).toEqual([]);
		}
		expect(storage.m.size).toBe(0);
	});

	it('reads a pasted address, and refuses what is not one', () => {
		expect(
			parseReturn(`http://localhost:5173${RETURN_PATH}?code=${CODE}&state=${STATE}`)
		).toMatchObject({
			code: CODE,
			state: STATE
		});
		expect(parseReturn('kein Link')).toBeNull();
		expect(parseReturn(`https://belege.example${RETURN_PATH}?state=${STATE}`)).toBeNull();
		expect(parseReturn(`https://x.example/?code=${'x'.repeat(600)}`)).toBeNull();
	});

	it('the started link is remembered once', () => {
		const storage = memoryStorage();
		rememberStart(storage, { state: STATE, bank: 'Beispielbank' });
		expect(takeStart(storage)).toMatchObject({ state: STATE, bank: 'Beispielbank' });
		expect(takeStart(storage)).toBeNull();
	});
});
