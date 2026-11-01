// Recovery words (#406, stage 2): BIP39 as everyone writes it – the published
// vectors for 32 bytes of entropy, the same seed as the reference library –
// the checksum catching a misread word, and what a person types or pastes.
import { describe, expect, it } from 'vitest';
import { mnemonicToSeed, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

import {
	checkWords,
	newRecoveryWords,
	normalizeWords,
	positionsToAsk,
	seedFromWords,
	wordsFromEntropy
} from './recovery-words.js';

const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');

describe('recovery words', () => {
	it('match the published BIP39 vectors for 256 bits', async () => {
		expect((await wordsFromEntropy(new Uint8Array(32))).join(' ')).toBe(
			`${'abandon '.repeat(23)}art`
		);
		expect((await wordsFromEntropy(new Uint8Array(32).fill(0x7f))).join(' ')).toBe(
			'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title'
		);
		expect((await wordsFromEntropy(new Uint8Array(32).fill(0xff))).join(' ')).toBe(
			`${'zoo '.repeat(23)}vote`
		);
	});

	it('give the same seed as the reference library', async () => {
		const words = await newRecoveryWords();
		expect(words).toHaveLength(24);
		expect(validateMnemonic(words.join(' '), wordlist)).toBe(true);
		expect(hex(await seedFromWords(words))).toBe(hex(await mnemonicToSeed(words.join(' '))));
	});

	it('a misread word fails the checksum, an unknown one is named', async () => {
		const words = await wordsFromEntropy(new Uint8Array(32).fill(0x7f));
		expect((await checkWords(words)).ok).toBe(true);
		const swapped = [...words];
		swapped[3] = words[3] === 'year' ? 'yard' : 'year';
		expect(await checkWords(swapped)).toMatchObject({ ok: false, checksum: false, unknown: [] });
		const typo = [...words];
		typo[4] = 'wavee';
		expect(await checkWords(typo)).toMatchObject({ ok: false, unknown: [5] });
		expect(await checkWords(words.slice(0, 23))).toMatchObject({ ok: false, count: 23 });
		await expect(seedFromWords(swapped)).rejects.toThrow(/not valid recovery words/);
	});

	it('read what a person types or pastes', () => {
		expect(normalizeWords(' 1. Legal  2) WINNER,\n3 thank\tyear ')).toEqual([
			'legal',
			'winner',
			'thank',
			'year'
		]);
	});

	it('ask back distinct positions, sorted', () => {
		for (let i = 0; i < 50; i++) {
			const p = positionsToAsk(3);
			expect(new Set(p).size).toBe(3);
			expect(p).toEqual([...p].sort((a, b) => a - b));
			expect(p.every((n) => n >= 1 && n <= 24)).toBe(true);
		}
	});
});
