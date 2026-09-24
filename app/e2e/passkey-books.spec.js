// A new passkey opens empty books, a booking survives a reload, and what the
// browser keeps on disk is ciphertext.
//
// Structure and helpers follow Le-Space/simple-todo apps/invoice01
// (e2e/passkey-identity.spec.js) at 56647d5; the virtual authenticator comes
// from packages/e2e-kit (see ./webauthn.js) and supports PRF.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator, recordCeremonies, takeCeremonies } from './webauthn.js';

/** Everything this origin keeps in IndexedDB and localStorage, as text. */
async function everythingStoredAsText(/** @type {import('@playwright/test').Page} */ page) {
	return page.evaluate(async () => {
		const decoder = new TextDecoder('utf-8', { fatal: false });
		/** @param {unknown} value @returns {string} */
		const asText = (value) => {
			if (value == null) return '';
			if (typeof value === 'string') return value;
			if (value instanceof ArrayBuffer) return decoder.decode(new Uint8Array(value));
			if (ArrayBuffer.isView(value)) {
				return decoder.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
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

test('a passkey opens sealed books that survive a reload', async ({ page }) => {
	const marker = `Marker-Stadtwerke-${Date.now().toString(36)}`;
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

	// A booking, through the real store.
	await page.evaluate(
		(counterparty) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: '2026-08-22',
				counterparty,
				purpose: 'Abschlag August',
				amountCents: -5259
			}),
		marker
	);
	await expect(page.getByTestId('transaction').filter({ hasText: marker })).toBeVisible();
	await expect(page.getByTestId('transaction-month')).toContainText('August 2026');
	await expect(page.getByTestId('transaction').filter({ hasText: marker })).toContainText('-52,59');

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
	// One prompt: the PRF evaluation. The signing key and identity are kept.
	expect(unlocked.map((c) => [c.kind, c.prf])).toEqual([['get', true]]);

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
	expect(text).not.toContain('Abschlag August');
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
