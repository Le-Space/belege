// Pairing: a one-time code on the bridge's console becomes a bearer token in
// the app.
//
// The code is shown only where the bridge runs, lasts ten minutes, and dies
// after one use or five wrong tries (a restart with `--pair` makes a new one).
// The token is 32 random bytes; the bridge keeps only its SHA-256, the app
// keeps the token inside its encrypted store.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O, 1/I

/** @param {string} token */
export function hashToken(token) {
	return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** `abcd efgh`, `ABCD-EFGH` → `ABCDEFGH` */
function canonicalCode(/** @type {unknown} */ code) {
	return String(code ?? '')
		.toUpperCase()
		.replace(/[^0-9A-Z]/g, '');
}

/**
 * @param {object} options
 * @param {() => { hash: string, createdAt: string }[]} options.getHashes
 * @param {(hashes: { hash: string, createdAt: string }[]) => Promise<void>} options.saveHashes
 * @param {() => number} [options.now]
 * @param {(n: number) => Buffer} [options.random]
 * @param {number} [options.ttlMs]
 * @param {number} [options.maxAttempts]
 */
export function createPairing({
	getHashes,
	saveHashes,
	now = Date.now,
	random = randomBytes,
	ttlMs = 10 * 60_000,
	maxAttempts = 5
}) {
	/** @type {{ code: string, expiresAt: number, attempts: number } | null} */
	let pending = null;

	return {
		/** A fresh code, replacing any earlier one. Formatted `ABCD-EFGH`. */
		issueCode() {
			const bytes = random(8);
			const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
			pending = { code, expiresAt: now() + ttlMs, attempts: 0 };
			return `${code.slice(0, 4)}-${code.slice(4)}`;
		},

		hasPendingCode() {
			return Boolean(pending && pending.expiresAt > now());
		},

		isPaired() {
			return getHashes().length > 0;
		},

		/**
		 * @param {unknown} code
		 * @returns {Promise<string>} the token, once
		 */
		async pair(code) {
			if (!pending || pending.expiresAt <= now()) {
				pending = null;
				throw Object.assign(
					new Error('No pairing code is active. Restart the bridge with --pair.'),
					{ status: 410 }
				);
			}
			const given = createHash('sha256').update(canonicalCode(code)).digest();
			const expected = createHash('sha256').update(pending.code).digest();
			if (!timingSafeEqual(given, expected)) {
				pending.attempts++;
				if (pending.attempts >= maxAttempts) pending = null;
				throw Object.assign(new Error('Wrong pairing code.'), { status: 403 });
			}
			pending = null;
			const token = random(32).toString('base64url');
			await saveHashes([
				...getHashes(),
				{ hash: hashToken(token), createdAt: new Date(now()).toISOString() }
			]);
			return token;
		},

		/** @param {string | undefined | null} token */
		verify(token) {
			if (!token) return false;
			const hash = Buffer.from(hashToken(token), 'hex');
			let found = false;
			for (const entry of getHashes()) {
				const stored = Buffer.from(String(entry.hash), 'hex');
				if (stored.length === hash.length && timingSafeEqual(stored, hash)) found = true;
			}
			return found;
		}
	};
}
