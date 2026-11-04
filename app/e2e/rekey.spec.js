// New keys for the books (#627), on one device: books with a payment and a
// receipt file get a new root under Einstellungen → Schlüssel; after the
// reload and one unlock the same payment and receipt are there, in databases
// with other addresses, under other keys and another identity of the books.
// Made-up names and amounts.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const MARKER = 'Schlüsselprobe-Wolkenfabrik';

/** @param {import('@playwright/test').Page} page */
const state = (page) =>
	page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const secrets = e2e.secrets();
		return {
			booksDid: String(e2e.booksDid()),
			addresses: e2e.addresses(),
			databaseKey: secrets.databaseKey,
			blobKey: secrets.blobKey,
			transactions: ((await e2e.transactions()) ?? []).map((/** @type {any} */ t) => t.counterparty)
		};
	});

test('new keys: the same books, in new databases under other keys', async ({ page }) => {
	test.setTimeout(180_000);
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('Laptop');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	const pdf = Array.from(new TextEncoder().encode('%PDF-1.4 Wolkenfabrik Hosting GmbH −12,34 €'));
	await page.evaluate(
		async ({ pdf, marker }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			await e2e.addTransaction({
				bookedOn: '2026-10-01',
				counterparty: marker,
				purpose: 'Probe',
				amountCents: -1234
			});
			await e2e.addReceiptFile(pdf, {
				source: 'upload',
				status: 'ausgelesen',
				mime: 'application/pdf',
				fileName: 'schluessel.pdf',
				vendor: marker,
				amountCents: 1234,
				currency: 'EUR',
				documentDate: '2026-09-30'
			});
		},
		{ pdf, marker: MARKER }
	);
	const before = await state(page);
	expect(before.transactions).toEqual([MARKER]);

	await page.getByTestId('settings-link').click();
	const keys = page.getByTestId('keys-card');
	await keys.getByTestId('keys-rekey-start').click();
	// This browser's passkey stays, and cannot be unticked.
	await expect(keys.getByTestId('keys-rekey-slot')).toHaveCount(1);
	await expect(keys.getByTestId('keys-rekey-slot')).toBeChecked();
	await expect(keys.getByTestId('keys-rekey-slot')).toBeDisabled();
	await keys.getByTestId('keys-rekey-next').click();
	const confirm = keys.getByTestId('keys-rekey-confirm');
	await expect(confirm).toContainText('Wiederherstellungswörter gelten nicht mehr');
	await expect(confirm).toContainText('neuen Beitrittscode');
	await expect(confirm).toContainText('neu gekoppelt');
	await confirm.getByTestId('keys-rekey-yes').click();

	// The page reloads; one unlock opens the new books, and they take the packed ones over.
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click({
		timeout: 60_000
	});
	await expect(page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
	await expect
		.poll(async () => (await state(page)).transactions, { timeout: 60_000 })
		.toEqual([MARKER]);
	const after = await state(page);
	expect(after.booksDid).not.toBe(before.booksDid);
	expect(after.databaseKey).not.toBe(before.databaseKey);
	expect(after.blobKey).not.toBe(before.blobKey);
	for (const [name, address] of Object.entries(before.addresses)) {
		expect(after.addresses[name], name).not.toBe(address);
	}
	// The receipt came along, with its file.
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await expect(page.getByText(MARKER).first()).toBeVisible();

	await page.getByTestId('settings-link').click();
	await expect(page.getByTestId('keys-rekey-done')).toContainText('neue Schlüssel');
	// The packed books are gone from this browser.
	expect(
		await page.evaluate(
			() =>
				new Promise((resolve) => {
					const r = indexedDB.open('belege-rekey', 1);
					r.onsuccess = () => {
						const db = r.result;
						const get = db.transaction('files').objectStore('files').get('books');
						get.onsuccess = () => resolve(get.result ?? null);
					};
					r.onupgradeneeded = () => r.result.createObjectStore('files');
				})
		)
	).toBeNull();
});

test('another device of the owner switches to the new keys by itself', async ({ browser }) => {
	test.setTimeout(360_000);
	const { device, samePasskey } = await import('./devices.js');
	const { openIntegration } = await import('./integrations.js');
	const mac = await device(browser);
	const phone = await device(browser);
	try {
		await mac.page.goto('/');
		await acceptConsent(mac.page);
		await mac.page.getByTestId('passkey-label').fill('E2E Schlüssel');
		await mac.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(mac.page.getByTestId('own-did')).toBeVisible();
		const did = String(await mac.page.getByTestId('own-did').getAttribute('data-did'));
		await mac.page.getByRole('link', { name: 'Zahlungen', exact: true }).click();
		await mac.page.getByTestId('add-test-transaction').click();
		await expect(mac.page.getByTestId('transaction')).toHaveCount(1);
		await samePasskey(mac, phone, did);

		// Connected, as in device-sync.spec.js: the phone scans the Mac's code.
		await openIntegration(mac.page, 'geraete');
		await expect(mac.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		const macId = String(await mac.page.getByTestId('devices-self-value').textContent()).trim();
		await mac.page.getByTestId('devices-qr-toggle').click();
		const code = String(await mac.page.getByTestId('devices-qr').getAttribute('data-code'));
		await openIntegration(phone.page, 'geraete');
		await expect(phone.page.getByTestId('devices-reachable')).toContainText(
			'über den Relay erreichbar',
			{ timeout: 30_000 }
		);
		await phone.page.getByTestId('devices-scan').click();
		await phone.page.evaluate((c) => {
			/** @type {any} */ (globalThis).__scanValue = c;
		}, code);
		await expect(
			phone.page
				.getByTestId('devices-item')
				.filter({ hasText: macId })
				.getByTestId('devices-item-state')
		).toContainText('verbunden', { timeout: 60_000 });
		await expect
			.poll(async () => (await state(phone.page)).transactions.length, {
				timeout: 60_000
			})
			.toBe(1);
		const before = await state(phone.page);

		// New keys on the Mac.
		await mac.page.getByTestId('settings-link').click();
		const keys = mac.page.getByTestId('keys-card');
		await keys.getByTestId('keys-rekey-start').click();
		await keys.getByTestId('keys-rekey-next').click();
		await keys.getByTestId('keys-rekey-yes').click();
		await mac.page.getByTestId('passkey-unlock').click({ timeout: 90_000 });
		await expect(mac.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
		await expect
			.poll(async () => (await state(mac.page)).transactions.length, {
				timeout: 60_000
			})
			.toBe(1);
		const macAfter = await state(mac.page);
		expect(macAfter.booksDid).not.toBe(before.booksDid);

		// The phone, at its next unlock, takes the new vault, opens the new books
		// and dials the Mac there: the booking comes over.
		await phone.page.reload();
		await phone.page.getByTestId('passkey-unlock').click();
		await phone.page.getByTestId('passkey-unlock').click({ timeout: 60_000 });
		await expect(phone.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
		await expect
			.poll(async () => (await state(phone.page)).booksDid, { timeout: 60_000 })
			.toBe(macAfter.booksDid);
		await expect
			.poll(async () => (await state(phone.page)).transactions.length, { timeout: 120_000 })
			.toBe(1);
		expect((await state(phone.page)).databaseKey).toBe(macAfter.databaseKey);
	} finally {
		await mac.context.close();
		await phone.context.close();
	}
});
