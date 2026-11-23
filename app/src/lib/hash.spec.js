import { describe, expect, it } from 'vitest';

import { sha256Hex } from './hash.js';

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('sha256Hex', () => {
	it('hashes a string as its UTF-8', async () => {
		expect(await sha256Hex('abc')).toBe(ABC);
		expect(await sha256Hex('')).toBe(EMPTY);
	});

	it('hashes bytes as they are, the same as the string they encode', async () => {
		expect(await sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(ABC);
		expect(await sha256Hex(new Uint8Array())).toBe(EMPTY);
		const text = 'Wolkenfabrik Hosting GmbH · −12,34 €';
		expect(await sha256Hex(new TextEncoder().encode(text))).toBe(await sha256Hex(text));
	});

	it('answers lowercase hex, 64 digits', async () => {
		expect(await sha256Hex('Stromwerk Test AG')).toMatch(/^[0-9a-f]{64}$/);
	});
});
