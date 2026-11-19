// What this origin keeps on disk, as text, for at-rest checks. Moved out of
// passkey-books.spec.js so every spec can scan the same way.

/**
 * Everything this origin keeps in IndexedDB, localStorage and sessionStorage,
 * as text (Cache Storage: `cachedResponsesHolding`, below). Bytes
 * appear twice: decoded as UTF-8 (for markers and DIDs) and as hex (for keys,
 * which UTF-8 decoding would mangle).
 */
export async function everythingStoredAsText(/** @type {import('@playwright/test').Page} */ page) {
	return page.evaluate(async () => {
		const decoder = new TextDecoder('utf-8', { fatal: false });
		/** @param {unknown} value @returns {string} */
		const asText = (value) => {
			if (value == null) return '';
			if (typeof value === 'string') return value;
			/** @param {Uint8Array} bytes */
			const both = (bytes) =>
				decoder.decode(bytes) +
				'\n' +
				Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
			if (value instanceof ArrayBuffer) return both(new Uint8Array(value));
			if (ArrayBuffer.isView(value)) {
				return both(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
			}
			if (typeof value === 'object') {
				return Object.values(/** @type {Record<string, unknown>} */ (value))
					.map(asText)
					.join('\n');
			}
			return String(value);
		};

		/** @type {{ database: string, records: number }[]} */
		const inventory = [];
		let text = '';
		for (const { name } of await indexedDB.databases()) {
			if (!name) continue;
			const db = await new Promise((resolve, reject) => {
				const request = indexedDB.open(name);
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			let records = 0;
			for (const storeName of /** @type {IDBDatabase} */ (db).objectStoreNames) {
				const tx = /** @type {IDBDatabase} */ (db).transaction(storeName, 'readonly');
				const store = tx.objectStore(storeName);
				const [keys, values] = await Promise.all(
					[store.getAllKeys(), store.getAll()].map(
						(request) =>
							new Promise((resolve, reject) => {
								request.onsuccess = () => resolve(request.result);
								request.onerror = () => reject(request.error);
							})
					)
				);
				records += /** @type {unknown[]} */ (values).length;
				text += asText(keys) + '\n' + asText(values) + '\n';
			}
			/** @type {IDBDatabase} */ (db).close();
			inventory.push({ database: name, records });
		}
		for (const storage of [localStorage, sessionStorage]) {
			for (let i = 0; i < storage.length; i++) {
				const key = /** @type {string} */ (storage.key(i));
				text += key + '\n' + storage.getItem(key) + '\n';
			}
		}
		return { inventory, text };
	});
}

/**
 * The responses in this origin's Cache Storage (the service worker's) that
 * hold one of `needles`, or the bytes of one of `secrets` as they are. Searched
 * in the page: a cache holds the whole app, too much to hand to the test.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ needles?: string[], secrets?: string[] }} what `needles` as text (markers,
 *   the spellings of a key), `secrets` in hex (looked for as raw bytes)
 * @returns {Promise<{ responses: number, hits: { cache: string, url: string }[] }>}
 */
export async function cachedResponsesHolding(page, { needles = [], secrets = [] }) {
	return page.evaluate(
		async ({ needles, secrets }) => {
			// One character per byte, so text and raw bytes are found the same way.
			const latin1 = new TextDecoder('latin1');
			const raw = secrets.map((hex) =>
				String.fromCharCode(...(hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16)))
			);
			const wanted = [...needles.map((n) => latin1.decode(new TextEncoder().encode(n))), ...raw];
			/** @type {{ cache: string, url: string }[]} */
			const hits = [];
			let responses = 0;
			for (const name of await caches.keys()) {
				const cache = await caches.open(name);
				for (const request of await cache.keys()) {
					const response = await cache.match(request);
					if (!response) continue;
					responses++;
					const body = latin1.decode(await response.arrayBuffer());
					if (wanted.some((w) => (request.url + '\n' + body).includes(w))) {
						hits.push({ cache: name, url: request.url });
					}
				}
			}
			return { responses, hits };
		},
		{ needles, secrets }
	);
}

/**
 * The ways a 32-byte-or-longer secret could be written down: hex, base64,
 * base64url, and a JSON number array (the stored credential uses those for
 * bytes). Each for the whole secret and for its first 32 bytes — an Ed25519
 * private key is kept as seed ‖ public key, and the seed alone is the secret.
 *
 * @param {string} hex
 * @returns {string[]}
 */
export function spellings(hex) {
	const forms = new Set();
	for (const part of new Set([hex, hex.slice(0, 64)])) {
		const bytes = Buffer.from(part, 'hex');
		forms.add(part);
		forms.add(part.toUpperCase());
		forms.add(bytes.toString('base64').replace(/=+$/, ''));
		forms.add(bytes.toString('base64url'));
		forms.add(Array.from(bytes).join(','));
	}
	return [...forms];
}
