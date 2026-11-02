// Recovery words for the books' vault (#406, stage 2): 24 words on paper that
// open the vault when every passkey is gone.
//
// The format is BIP39 – 256 random bits, a checksum, 24 words from the
// English list – as paperless-anywhere uses it and as the identity provider
// package plans its phrase slot (Le-Space/orbitdb-identity-provider-webauthn-did
// #92, #93), so one set of words means the same everywhere. From the words,
// BIP39's seed (PBKDF2-HMAC-SHA512, 2048 rounds, salt "mnemonic"), and from
// the seed, by HKDF, the keys Belege uses (books-vault.js, vault-index.js).
// The words carry 256 random bits: no stretching could make them stronger,
// and none is needed. Only WebCrypto; the list is data.
//
// The words are made here, never chosen by a person, shown once, and never
// stored: what is kept is a slot in the vault, sealed under a key from them.

import { wordlist } from '@scure/bip39/wordlists/english';

/** How many words: 256 bits and an 8-bit checksum, 11 bits a word. */
export const WORD_COUNT = 24;
const ENTROPY_BYTES = 32;

/** @param {Uint8Array} bytes */
async function sha256(bytes) {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)));
}

/**
 * The words for `entropy`, BIP39: the bits of the entropy and of its SHA-256
 * checksum, in groups of 11, each an index into the list.
 *
 * @param {Uint8Array} entropy 32 bytes
 * @returns {Promise<string[]>}
 */
export async function wordsFromEntropy(entropy) {
	if (!(entropy instanceof Uint8Array) || entropy.length !== ENTROPY_BYTES) {
		throw new TypeError(`Recovery words come from ${ENTROPY_BYTES} bytes`);
	}
	const checksum = (await sha256(entropy))[0];
	const bits = [...entropy, checksum].map((b) => b.toString(2).padStart(8, '0')).join('');
	/** @type {string[]} */
	const words = [];
	for (let i = 0; i < WORD_COUNT; i++) {
		words.push(wordlist[parseInt(bits.slice(i * 11, i * 11 + 11), 2)]);
	}
	return words;
}

/** New recovery words: 256 bits from the browser's random source. */
export async function newRecoveryWords() {
	const entropy = crypto.getRandomValues(new Uint8Array(ENTROPY_BYTES));
	try {
		return await wordsFromEntropy(entropy);
	} finally {
		entropy.fill(0);
	}
}

/**
 * The words in what a person typed or pasted: case, numbering ("1." or
 * "1)"), commas and line breaks do not matter.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function normalizeWords(text) {
	return String(text ?? '')
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[0-9]+[.)]?/g, ' ')
		.split(/[^a-z]+/)
		.filter(Boolean);
}

/**
 * Whether these are recovery words: how many, which are not on the list
 * (1-based positions), and whether the checksum holds – a word misread from
 * paper fails it.
 *
 * @param {string[]} words
 * @returns {Promise<{ ok: boolean, count: number, unknown: number[], checksum: boolean }>}
 */
export async function checkWords(words) {
	const unknown = words.flatMap((w, i) => (wordlist.includes(w) ? [] : [i + 1]));
	if (words.length !== WORD_COUNT || unknown.length) {
		return { ok: false, count: words.length, unknown, checksum: false };
	}
	const bits = words.map((w) => wordlist.indexOf(w).toString(2).padStart(11, '0')).join('');
	const entropy = Uint8Array.from({ length: ENTROPY_BYTES }, (_, i) =>
		parseInt(bits.slice(i * 8, i * 8 + 8), 2)
	);
	const checksum = (await sha256(entropy))[0] === parseInt(bits.slice(256, 264), 2);
	entropy.fill(0);
	return { ok: checksum, count: words.length, unknown, checksum };
}

/**
 * BIP39's seed for the words (no passphrase): what every key from the words
 * is derived from. Refuses words that do not check.
 *
 * @param {string[]} words
 * @returns {Promise<Uint8Array>} 64 bytes
 */
export async function seedFromWords(words) {
	if (!(await checkWords(words)).ok) throw new Error('These are not valid recovery words.');
	const password = new TextEncoder().encode(words.join(' ').normalize('NFKD'));
	const key = await crypto.subtle.importKey('raw', password, 'PBKDF2', false, ['deriveBits']);
	password.fill(0);
	const bits = await crypto.subtle.deriveBits(
		{
			name: 'PBKDF2',
			hash: 'SHA-512',
			salt: new TextEncoder().encode('mnemonic'),
			iterations: 2048
		},
		key,
		512
	);
	return new Uint8Array(bits);
}

/**
 * Which words to ask back, 1-based and sorted: `count` of them, at random.
 *
 * @param {number} [count]
 * @returns {number[]}
 */
export function positionsToAsk(count = 3) {
	/** @type {number[]} */
	const picked = [];
	const random = new Uint32Array(1);
	while (picked.length < count) {
		crypto.getRandomValues(random);
		const n = (random[0] % WORD_COUNT) + 1;
		if (!picked.includes(n)) picked.push(n);
	}
	return picked.sort((a, b) => a - b);
}
