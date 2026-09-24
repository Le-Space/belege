// A new passkey opens empty books, a booking survives a reload, what the
// browser keeps on disk is ciphertext, and no private key is kept at all.
//
// Structure and helpers follow Le-Space/simple-todo apps/invoice01
// (e2e/passkey-identity.spec.js) at 56647d5; the virtual authenticator comes
// from packages/e2e-kit (see ./webauthn.js) and supports PRF.
import { test, expect } from '@playwright/test';
import {
	addVirtualAuthenticator,
	forgetThisDevice,
	recordCeremonies,
	takeCeremonies
} from './webauthn.js';

/**
 * Everything this origin keeps in IndexedDB and localStorage, as text. Bytes
 * appear twice: decoded as UTF-8 (for markers and DIDs) and as hex (for keys,
 * which UTF-8 decoding would mangle).
 */
async function everythingStoredAsText(/** @type {import('@playwright/test').Page} */ page) {
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
		for (let i = 0; i < localStorage.length; i++) {
			const key = /** @type {string} */ (localStorage.key(i));
			text += key + '\n' + localStorage.getItem(key) + '\n';
		}
		return { inventory, text };
	});
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
function spellings(hex) {
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

/** @param {import('@playwright/test').Page} page */
async function sessionFacts(page) {
	return page.evaluate(() => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		return {
			did: /** @type {string} */ (e2e.did()),
			identityHash: /** @type {string} */ (e2e.identityHash()),
			peerId: /** @type {string} */ (e2e.peerId()),
			secrets: /** @type {{ signingKey: string, databaseKey: string, peerKey: string }} */ (
				e2e.secrets()
			)
		};
	});
}

/** @param {import('@playwright/test').Page} page @param {string} counterparty */
async function book(page, counterparty) {
	await page.evaluate(
		(counterparty) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: '2026-08-22',
				counterparty,
				purpose: 'Abschlag August',
				amountCents: -5259
			}),
		counterparty
	);
}

/** The keystore database a PR #1 build wrote, with a record in it. */
async function plantLegacyKeystore(/** @type {import('@playwright/test').Page} */ page) {
	await page.evaluate(
		() =>
			new Promise((resolve, reject) => {
				const request = indexedDB.open('level-js-belege/orbitdb/keystore');
				request.onupgradeneeded = () => request.result.createObjectStore('belege/orbitdb/keystore');
				request.onsuccess = () => {
					const db = request.result;
					const tx = db.transaction('belege/orbitdb/keystore', 'readwrite');
					tx.objectStore('belege/orbitdb/keystore').put(new Uint8Array(32), 'private_legacy');
					tx.oncomplete = () => {
						db.close();
						resolve(undefined);
					};
					tx.onerror = () => reject(tx.error);
				};
				request.onerror = () => reject(request.error);
			})
	);
}

test('a passkey opens sealed books that survive a reload', async ({ page }) => {
	const marker = `Marker-Stadtwerke-${Date.now().toString(36)}`;
	const afterReload = `Marker-Miete-${Date.now().toString(36)}`;
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	// Create a passkey: the books open, empty.
	await page.goto('/');
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	const didBadge = page.getByTestId('own-did');
	await expect(didBadge).toBeVisible();
	const did = await didBadge.getAttribute('data-did');
	expect(did).toMatch(/^did:key:/);

	const created = await takeCeremonies(page);
	console.log('ceremonies on create:', JSON.stringify(created));
	expect(created.every((c) => c.ok)).toBe(true);
	// Three prompts: register, one PRF evaluation (the database key and the
	// signing key both come from it), and the identity signature.
	expect(created.map((c) => [c.kind, c.prf])).toEqual([
		['create', true],
		['get', true],
		['get', false]
	]);

	await page.getByRole('link', { name: 'Zahlungen' }).click();
	await expect(page.getByTestId('transactions-empty')).toHaveText(
		'Noch keine Zahlungen – Bankanbindung folgt in Schritt 2'
	);

	const first = await sessionFacts(page);
	expect(first.did).toBe(did);
	expect(first.secrets?.signingKey).toMatch(/^[0-9a-f]{64}$/);

	// A booking, through the real store.
	await book(page, marker);
	await expect(page.getByTestId('transaction').filter({ hasText: marker })).toBeVisible();
	await expect(page.getByTestId('transaction-month')).toContainText('August 2026');
	await expect(page.getByTestId('transaction').filter({ hasText: marker })).toContainText('-52,59');

	// What an earlier build left behind: its keystore database. The next
	// unlock deletes it.
	await plantLegacyKeystore(page);

	// Reload (still on /zahlungen, served by the SPA fallback): the stored
	// passkey unlocks the same identity and the same books.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(didBadge).toHaveAttribute('data-did', /** @type {string} */ (did));
	await expect(page.getByTestId('transaction').filter({ hasText: marker })).toBeVisible();
	await page.getByRole('link', { name: 'Home' }).click();
	await expect(page.getByTestId('count-transactions')).toHaveText('1');

	const unlocked = await takeCeremonies(page);
	console.log('ceremonies on unlock:', JSON.stringify(unlocked));
	// One prompt: the PRF evaluation. The signing key is derived from it again,
	// and the identity's passkey proof (public) is kept, so nothing else asks.
	expect(unlocked.map((c) => [c.kind, c.prf])).toEqual([['get', true]]);

	// The same identity: the key derived again is the key, and the identity
	// document is the same document. The peer key is new every session.
	const second = await sessionFacts(page);
	expect(second.did).toBe(did);
	expect(second.identityHash).toBe(first.identityHash);
	expect(second.secrets.signingKey).toBe(first.secrets.signingKey);
	expect(second.secrets.databaseKey).toBe(first.secrets.databaseKey);
	expect(second.peerId).not.toBe(first.peerId);
	expect(second.secrets.peerKey).not.toBe(first.secrets.peerKey);

	// Writable with the key derived again: access control (`write: [did]`)
	// accepts the entry, and it is there after one more reload.
	await book(page, afterReload);
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(didBadge).toHaveAttribute('data-did', /** @type {string} */ (did));
	await expect(page.getByTestId('count-transactions')).toHaveText('2');
	await page.getByRole('link', { name: 'Zahlungen' }).click();
	await expect(page.getByTestId('transaction').filter({ hasText: marker })).toBeVisible();
	await expect(page.getByTestId('transaction').filter({ hasText: afterReload })).toBeVisible();
	const third = await sessionFacts(page);
	expect(third.identityHash).toBe(first.identityHash);
	expect(await takeCeremonies(page)).toHaveLength(1);

	// On disk: the belege databases exist and hold data, the DID is in there
	// in the clear (identity documents are public) — which proves the scan
	// reads what is stored — and the counterparty is not.
	const { inventory, text } = await everythingStoredAsText(page);
	console.log('IndexedDB inventory:', JSON.stringify(inventory));
	const belege = inventory.filter((db) => db.database.includes('belege/'));
	expect(belege.map((db) => db.database).join(' ')).toContain('belege/helia-blocks');
	expect(belege.reduce((sum, db) => sum + db.records, 0)).toBeGreaterThan(0);
	expect(text).toContain(/** @type {string} */ (did));
	expect(text).not.toContain(marker);
	expect(text).not.toContain(afterReload);
	expect(text).not.toContain('Abschlag August');

	// No private key at rest: no keystore database, and none of the keys this
	// session or the two before it held, in any spelling, anywhere.
	expect(inventory.map((db) => db.database)).not.toContain('level-js-belege/orbitdb/keystore');
	expect(inventory.some((db) => /keystore/i.test(db.database))).toBe(false);
	// The scan reads the log: every entry names its identity document by hash.
	expect(text).toContain(first.identityHash);
	const secrets = {
		'signing key': first.secrets.signingKey,
		'database key': first.secrets.databaseKey,
		'peer key (1st session)': first.secrets.peerKey,
		'peer key (2nd session)': second.secrets.peerKey,
		'peer key (3rd session)': third.secrets.peerKey
	};
	for (const [name, hex] of Object.entries(secrets)) {
		for (const spelling of spellings(hex)) {
			expect(text.includes(spelling), `${name} stored as ${spelling.slice(0, 12)}…`).toBe(false);
		}
	}
});

test('a restored passkey derives the same signing key and keeps none', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await recordCeremonies(page);

	await page.goto('/');
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const created = await sessionFacts(page);
	await takeCeremonies(page);

	// A device that has never seen this passkey: nothing stored, no credential.
	await forgetThisDevice(page);
	await page.goto('/');
	await page.getByTestId('passkey-restore').click();
	await expect(page.getByTestId('own-did')).toHaveAttribute('data-did', created.did);

	const restoring = await takeCeremonies(page);
	console.log('ceremonies on restore:', JSON.stringify(restoring));
	expect(restoring.every((c) => c.ok)).toBe(true);
	// Four prompts: the provider's two restore touches (DID, then signing key
	// from PRF), the PRF read for the database key, and the identity signature
	// (a new device has no cached proof). Unchanged by keeping no key at rest.
	expect(restoring.map((c) => [c.kind, c.prf])).toEqual([
		['get', true],
		['get', false],
		['get', true],
		['get', false]
	]);
	const restored = await sessionFacts(page);
	expect(restored.secrets.signingKey).toBe(created.secrets.signingKey);
	expect(restored.secrets.databaseKey).toBe(created.secrets.databaseKey);

	// Writable, and no key on this device either.
	await book(page, 'Marker-Restore');
	await page.getByRole('link', { name: 'Home' }).click();
	await expect(page.getByTestId('count-transactions')).toHaveText('1');
	const { inventory, text } = await everythingStoredAsText(page);
	expect(inventory.some((db) => /keystore/i.test(db.database))).toBe(false);
	for (const spelling of [
		...spellings(restored.secrets.signingKey),
		...spellings(restored.secrets.databaseKey),
		...spellings(restored.secrets.peerKey)
	]) {
		expect(text.includes(spelling), `stored as ${spelling.slice(0, 12)}…`).toBe(false);
	}
});

test('without PRF the books stay shut, with a clear message', async ({ page }) => {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasPrf: false,
			automaticPresenceSimulation: true
		}
	});

	await page.goto('/');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();

	await expect(page.getByTestId('passkey-error')).toContainText('kein PRF-Geheimnis');
	await expect(page.getByTestId('own-did')).toHaveCount(0);
	const { inventory } = await everythingStoredAsText(page);
	expect(inventory.filter((db) => db.database.includes('belege/'))).toEqual([]);
});
