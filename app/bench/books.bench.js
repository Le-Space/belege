// How the books behave as they grow: made-up books of 1 000, 10 000, …
// bookings (BENCH_SIZES), written through the real store in a real browser,
// then timed – opening the books, the app's refresh, a matching run, reading
// and updating an old and a new record – and the space IndexedDB takes.
// Results go to bench/results/<date>-<size>.json and are printed as a table.
//
// Every name, amount and number here is made up.
import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';

import { addVirtualAuthenticator } from '../e2e/webauthn.js';
import { acceptConsent } from '../e2e/consent.js';

const SIZES = (process.env.BENCH_SIZES || '1000,10000')
	.split(',')
	.map((s) => Number(s.trim()))
	.filter((n) => Number.isInteger(n) && n > 0);
const BATCH = 250;

/** A small deterministic PRNG, so every run writes the same books. @param {number} seed */
function prng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Made-up books with the ratios of a small company: per booking about 0,6
 * receipts (most of them for a booking), one event, and a re-sync that
 * updates the newest tenth of the bookings once more.
 *
 * @param {number} size bookings
 */
function books(size) {
	const rnd = prng(size);
	const vendors = Array.from(
		{ length: Math.max(20, Math.round(size / 25)) },
		(_, i) => `Lieferant ${String(i + 1).padStart(4, '0')} GmbH`
	);
	const day = (/** @type {number} */ i) =>
		new Date(Date.UTC(2025, 0, 1) + Math.floor((i / size) * 365) * 864e5)
			.toISOString()
			.slice(0, 10);
	const accounts = [
		{
			source: 'hibiscus',
			sourceAccountId: 'bench-1',
			ibanLast4: '0001',
			name: 'Konto A',
			currency: 'EUR'
		},
		{
			source: 'hibiscus',
			sourceAccountId: 'bench-2',
			ibanLast4: '0002',
			name: 'Konto B',
			currency: 'EUR'
		}
	];
	/** @type {Record<string, any>[]} */
	const transactions = [];
	/** @type {Record<string, any>[]} */
	const receipts = [];
	for (let i = 0; i < size; i++) {
		const vendor = vendors[Math.floor(rnd() * vendors.length)];
		const cents = -Math.round(500 + rnd() * 150000);
		const bookedOn = day(i);
		transactions.push({
			accountIndex: i % 2,
			source: 'hibiscus',
			sourceId: `bench-${i}`,
			bookedOn,
			valueDate: bookedOn,
			amountCents: rnd() < 0.15 ? -cents : cents,
			currency: 'EUR',
			counterparty: vendor,
			counterpartyIban: '',
			purpose: `Rechnung RE-${100000 + i} Kunde 4711`,
			endToEndId: '',
			bookingType: 'Basislastschrift',
			bankCode: '',
			receiptId: null,
			deleted: false
		});
		if (rnd() < 0.6) {
			const matching = rnd() < 0.8;
			const gross = Math.abs(matching ? cents : Math.round(500 + rnd() * 150000)) / 100;
			receipts.push({
				source: 'mail',
				authVerdict: 'pass',
				status: 'ausgelesen',
				subject: `Ihre Rechnung RE-${100000 + i}`,
				from: `${vendor} <rechnung@lieferant.example>`,
				vendor,
				amountCents: Math.round(gross * 100),
				currency: 'EUR',
				documentDate: bookedOn,
				invoiceNumber: `RE-${100000 + i}`,
				extraction: {
					document_type: 'invoice',
					vendor,
					invoice_number: `RE-${100000 + i}`,
					customer_number: null,
					invoice_date: bookedOn,
					due_or_debit_date: null,
					currency: 'EUR',
					gross,
					payment: null,
					iban_last4: null
				},
				deleted: false
			});
		}
	}
	const events = transactions.map((t, i) => ({
		kind: 'bank-sync',
		at: `${t.bookedOn}T08:00:00.000Z`,
		source: 'hibiscus',
		accounts: 1,
		new: 1 + (i % 3),
		updated: 0,
		skipped: 0
	}));
	return { accounts, transactions, receipts, events };
}

/** @param {number} ms */
const round = (ms) => Math.round(ms);

/** @type {Record<string, any>[]} */
const results = [];

for (const size of SIZES) {
	test(`books of ${size} bookings`, async ({ page }) => {
		const data = books(size);
		/** @type {Record<string, any>} */
		const r = { size, receipts: data.receipts.length, events: data.events.length };

		await addVirtualAuthenticator(page);
		await page.goto('/');
		await acceptConsent(page);
		await page.getByTestId('passkey-label').fill('Bench');
		await page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(page.getByTestId('own-did')).toBeVisible();

		/** @param {string} name @param {Record<string, any>[]} records @returns {Promise<{ ids: string[], ms: number }>} */
		async function write(name, records) {
			const start = Date.now();
			/** @type {string[]} */
			const ids = [];
			for (let i = 0; i < records.length; i += BATCH) {
				const chunk = records.slice(i, i + BATCH);
				ids.push(
					...(await page.evaluate(
						([n, c]) => /** @type {any} */ (window).__belegeE2E.bench.putMany(n, c),
						/** @type {const} */ ([name, chunk])
					))
				);
			}
			return { ids, ms: Date.now() - start };
		}

		// Write the books.
		const accounts = await write('accounts', data.accounts);
		const txs = data.transactions.map(({ accountIndex, ...t }) => ({
			...t,
			accountId: accounts.ids[accountIndex]
		}));
		const written = await write('transactions', txs);
		r.writeTransactionsMs = written.ms;
		r.writeReceiptsMs = (await write('receipts', data.receipts)).ms;
		r.writeEventsMs = (await write('events', data.events)).ms;
		// A re-sync: the newest tenth of the bookings once more (an update each).
		const newest = written.ids.slice(-Math.ceil(size / 10));
		const updates = newest.map((id, i) => ({
			...txs[txs.length - newest.length + i],
			id,
			purpose: `${txs[i].purpose} (aktualisiert)`
		}));
		r.updateNewestTenthMs = (await write('transactions', updates)).ms;

		const timed = (/** @type {string} */ what, /** @type {any[]} */ args = []) =>
			page.evaluate(async ([w, a]) => {
				const bench = /** @type {any} */ (window).__belegeE2E.bench;
				const t0 = performance.now();
				await bench[w](...a);
				return performance.now() - t0;
			}, /** @type {const} */ ([what, args]));

		// The app's own reads.
		r.refreshMs = round(await timed('refresh'));
		r.getNewestMs = round(await timed('get', ['transactions', written.ids.at(-1)]));
		r.getOldestMs = round(await timed('get', ['transactions', written.ids[0]]));
		r.matchingMs = round(await timed('match'));
		r.refreshAfterMatchingMs = round(await timed('refresh'));
		r.updateOldestMs = round(
			await timed('putMany', [
				'transactions',
				[{ ...txs[0], id: written.ids[0], purpose: 'geändert' }]
			])
		);

		// Opening the books again: reload, unlock, until Home counts every booking.
		await page.reload();
		const t0 = Date.now();
		await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
		await page.getByRole('link', { name: 'Home' }).click();
		await expect(page.getByTestId('count-transactions')).toHaveText(String(size));
		r.unlockToHomeMs = Date.now() - t0;

		const estimate = await page.evaluate(() => navigator.storage.estimate());
		r.storageMB = Math.round(((estimate.usage ?? 0) / 1e6) * 10) / 10;
		results.push(r);
		console.log(JSON.stringify(r));
	});
}

test.afterAll(async () => {
	if (!results.length) return;
	const machine = {
		cpus: cpus()[0]?.model ?? '?',
		cores: cpus().length,
		memGB: Math.round(totalmem() / 2 ** 30)
	};
	const date = new Date().toISOString().slice(0, 10);
	await mkdir(new URL('./results/', import.meta.url), { recursive: true });
	for (const r of results) {
		await writeFile(
			new URL(`./results/${date}-${r.size}.json`, import.meta.url),
			JSON.stringify({ date, machine, ...r }, null, '\t') + '\n'
		);
	}
	console.table(results);
});
