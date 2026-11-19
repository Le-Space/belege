// Which secret bytes a page handled, seen from outside the app: for at-rest
// checks against a build that has no test hook to ask (#536).
//
// The E2E build tells a spec its keys (`__belegeE2E.secrets()`); a production
// build must not. So the spy stands where every key passes on its way in or
// out of the browser's own cryptography, in the page (the app derives no key
// in a worker):
//   - what a passkey answers (the PRF results of `navigator.credentials`),
//   - key material handed to `crypto.subtle.importKey` for a symmetric or a
//     derivation algorithm, and private keys (pkcs8, a JWK with `d` or `k`),
//   - what `deriveBits` and `exportKey` hand back.
// Public keys and signatures are left out: those may be stored.
//
// `e2e-production/production-build.spec.js` compares the list with what the
// origin keeps; `e2e/passkey-books.spec.js` checks, in the E2E build, that the
// list holds every key the app names there – so a key that stops passing here
// is noticed.

/**
 * Derived, and not a secret: the names of the databases (docs/keys.md,
 * `belege/db-name/…`), which are on disk as what they are – names.
 */
export const PUBLIC_BY_DESIGN = /^deriveBits HKDF belege\/db-name\//;

/**
 * Installed before the first script of every page of the context.
 *
 * @param {import('@playwright/test').BrowserContext} context
 */
export async function spyOnSecrets(context) {
	await context.addInitScript(() => {
		/** @type {{ what: string, hex: string }[]} */
		const seen = [];
		Object.defineProperty(globalThis, '__secretSpy', { value: seen });

		/** @param {unknown} value @returns {Uint8Array | null} */
		const bytesOf = (value) => {
			if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
			if (ArrayBuffer.isView(value)) {
				return new Uint8Array(
					value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
				);
			}
			return null;
		};
		/** @param {string} what @param {unknown} value */
		const note = (what, value) => {
			const bytes = bytesOf(value);
			// Shorter than a key: a label or a counter, and too short to look for.
			if (!bytes || bytes.length < 16) return;
			const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
			if (!seen.some((s) => s.hex === hex)) seen.push({ what, hex });
		};
		/** @param {string} text base64url @returns {Uint8Array} */
		const fromBase64Url = (text) =>
			Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
		/** @param {unknown} algorithm @returns {string} */
		const nameOf = (algorithm) =>
			String(
				typeof algorithm === 'string' ? algorithm : /** @type {any} */ (algorithm?.name ?? '')
			).toUpperCase();
		/** The label a derivation was asked under, readable in a failure message. */
		const labelOf = (/** @type {any} */ algorithm) => {
			const info = bytesOf(algorithm?.info);
			return info ? new TextDecoder().decode(info).replace(/[^\x20-\x7e]/g, '.') : '';
		};
		const SECRET_INPUT = /^(HKDF|PBKDF2|HMAC|AES-GCM|AES-CTR|AES-CBC|AES-KW|CHACHA20-POLY1305)$/;

		const subtle = globalThis.crypto?.subtle;
		if (subtle) {
			const importKey = subtle.importKey.bind(subtle);
			subtle.importKey = /** @type {any} */ (
				(
					/** @type {string} */ format,
					/** @type {any} */ data,
					/** @type {any} */ algorithm,
					/** @type {any[]} */ ...rest
				) => {
					const name = nameOf(algorithm);
					if (format === 'raw' && SECRET_INPUT.test(name)) note(`importKey ${name}`, data);
					if (format === 'pkcs8') note(`importKey ${name} private`, data);
					if (format === 'jwk') {
						for (const field of ['d', 'k']) {
							if (typeof data?.[field] === 'string') {
								note(`importKey ${name} jwk.${field}`, fromBase64Url(data[field]));
							}
						}
					}
					return importKey(/** @type {any} */ (format), data, algorithm, ...rest);
				}
			);
			const deriveBits = subtle.deriveBits.bind(subtle);
			subtle.deriveBits = /** @type {any} */ (
				async (/** @type {any} */ algorithm, /** @type {any[]} */ ...rest) => {
					const bits = await deriveBits(algorithm, ...rest);
					note(`deriveBits ${nameOf(algorithm)} ${labelOf(algorithm)}`.trim(), bits);
					return bits;
				}
			);
			const exportKey = subtle.exportKey.bind(subtle);
			subtle.exportKey = /** @type {any} */ (
				async (/** @type {string} */ format, /** @type {CryptoKey} */ key) => {
					const out = await exportKey(/** @type {any} */ (format), key);
					if (key.type !== 'public') {
						if (format === 'jwk') {
							for (const field of ['d', 'k']) {
								const value = /** @type {any} */ (out)[field];
								if (typeof value === 'string') {
									note(`exportKey ${key.algorithm.name} jwk.${field}`, fromBase64Url(value));
								}
							}
						} else note(`exportKey ${key.algorithm.name}`, out);
					}
					return out;
				}
			);
		}

		// What the passkey answers. Only where there is a page (not in a worker).
		const credentials = globalThis.navigator?.credentials;
		if (credentials) {
			for (const kind of /** @type {const} */ (['create', 'get'])) {
				const original = credentials[kind].bind(credentials);
				credentials[kind] = /** @type {any} */ (
					async (/** @type {any} */ options) => {
						const result = /** @type {any} */ (await original(options));
						const prf = result?.getClientExtensionResults?.()?.prf?.results;
						note('passkey PRF first', prf?.first);
						note('passkey PRF second', prf?.second);
						return result;
					}
				);
			}
		}
	});
}

/**
 * Every secret the page handled so far: what it was, and its bytes in hex.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ what: string, hex: string }[]>}
 */
export async function secretsSeen(page) {
	return page.evaluate(() => [.../** @type {any} */ (globalThis).__secretSpy]);
}
