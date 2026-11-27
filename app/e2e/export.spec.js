// Kontierung and the monthly DATEV export end to end: a fake LLM, the real
// bridge in test mode (for reading an uploaded receipt), the app.
//
// Two bank accounts (Konto A ···0011, Konto B ···0022) and their ledger accounts
// under Einstellungen → a month with an expense, an income, a transfer
// between the two accounts and a bank fee → the export is blocked until
// every booking has a confirmed account → the automatic ones in one click,
// the expense (receipt uploaded, BU key 9 from its VAT) and the income by
// hand → the vendor is learned for its next booking → export: the ZIP is
// read here and its Buchungsstapel checked line by line → the Verlauf →
// nothing readable at rest.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { openSettings } from './settings.js';

import { defaultConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { makePdf } from '@belege/bridge/testing/pdf';
import { addVirtualAuthenticator } from './webauthn.js';
import { everythingStoredAsText } from './storage-scan.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const KABEL = {
	vendor: 'Kabelnetz Beispiel GmbH',
	invoice: 'KB-2026-0901',
	marker: 'MARKER-EXPORT-5A1B'
};
const CUSTOMER = 'Kunde Nördlich AG';
const MONTH = '2026-09';

const kabelPdf = makePdf([
	`Anbieter: ${KABEL.vendor}`,
	`Rechnungsnummer: ${KABEL.invoice}`,
	'Rechnungsdatum: 2026-08-28',
	'Netto: 33,61 EUR',
	'USt 19%: 6,38 EUR',
	'Brutto: 39,99 EUR',
	`Kennung: ${KABEL.marker}`
]);

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	llm = await startFakeLlm();
	bridge = await startBridge({
		name: 'export',
		config: {
			llm: {
				...defaultConfig().llm,
				model: 'deepseek-flash',
				retryModel: 'deepseek-v4-pro',
				baseUrl: llm.url,
				configured: true
			}
		},
		env: { BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY }
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await llm?.close();
});

test('assign accounts, export a month as DATEV Buchungsstapel with its receipts', async ({
	page
}) => {
	test.setTimeout(180_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab('Integrationen').click();
	await pairBridge(page, bridge);

	// Two bank accounts and a month of bookings, the way an import stores them.
	await page.evaluate(
		async ({ kabel, customer }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const account = (/** @type {string} */ name, /** @type {string} */ last4) =>
				e2e.addAccount({
					source: 'hibiscus',
					sourceAccountId: last4,
					ibanLast4: last4,
					name,
					currency: 'EUR'
				});
			const a = await account('Konto A Test', '0011');
			const b = await account('Konto B Test', '0022');
			const add = (/** @type {Record<string, any>} */ tx) =>
				e2e.addTransaction({ currency: 'EUR', counterpartyIban: '', bookingType: '', ...tx });
			await add({
				accountId: a.id,
				bookedOn: '2026-09-01',
				counterparty: 'KABELNETZ BEISPIEL',
				purpose: `Rechnung ${kabel.invoice}`,
				amountCents: -3999
			});
			await add({
				accountId: a.id,
				bookedOn: '2026-09-15',
				counterparty: customer,
				purpose: 'Rechnung 2026-17',
				amountCents: 11900
			});
			await add({
				accountId: a.id,
				bookedOn: '2026-09-20',
				counterparty: 'MUSTER UG',
				purpose: 'Umbuchung Konto B',
				amountCents: -50000
			});
			await add({
				accountId: b.id,
				bookedOn: '2026-09-21',
				counterparty: 'MUSTER UG',
				purpose: 'Top-up',
				amountCents: 50000
			});
			await add({
				accountId: a.id,
				bookedOn: '2026-09-30',
				counterparty: '',
				purpose: 'Abschluss per Quartalsende',
				bookingType: 'Abschluss',
				amountCents: -990
			});
		},
		{ kabel: KABEL, customer: CUSTOMER }
	);

	// Einstellungen: the ledger accounts, suggested 1200 and 1210 as placeholders only.
	await openSettings(page, 'buchhaltung');
	const ledger = (/** @type {string} */ last4) =>
		page.locator(`[data-testid="ledger-account"][data-account="${last4}"]`);
	await expect(ledger('0011')).toHaveAttribute('placeholder', '1200');
	await expect(ledger('0022')).toHaveAttribute('placeholder', '1210');
	await expect(ledger('0011')).toHaveValue('');
	await expect(page.getByTestId('datev-consultant')).toHaveValue('1001');
	await expect(page.getByTestId('datev-client')).toHaveValue('1');
	await expect(page.getByTestId('datev-key-reverseCharge')).toHaveValue('94');

	// Without ledger accounts and confirmed accounts the export is blocked.
	await tab('Export').click();
	const check = (/** @type {string} */ kind) =>
		page.locator(`[data-testid="export-check"][data-check="${kind}"]`);
	await expect(page.getByTestId('export-summary')).toContainText('5 Buchungen');
	await expect(check('unassigned')).toHaveAttribute('data-state', 'blocker');
	await expect(check('unassigned').getByTestId('export-check-text')).toContainText(
		'5 Buchungen ohne übernommenes Konto'
	);
	await expect(check('ledger')).toHaveAttribute('data-state', 'blocker');
	await expect(check('ledger')).toContainText('Konto A Test ···0011');
	await expect(page.getByTestId('export-download')).toBeDisabled();

	await openSettings(page, 'buchhaltung');
	await ledger('0011').fill('1200');
	await ledger('0022').fill('1210');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();

	// The transfer (both sides) and the fee: one click takes their automatic accounts.
	await tab('Export').click();
	await expect(check('ledger')).toHaveAttribute('data-state', 'ok');
	await expect(page.getByTestId('export-auto-confirm')).toHaveText(
		'Konten aus Umbuchung, Bankgebühr und Reisekostenabrechnung übernehmen (3)'
	);
	await page.getByTestId('export-auto-confirm').click();
	await expect(check('unassigned').getByTestId('export-check-text')).toContainText(
		'2 Buchungen ohne übernommenes Konto'
	);
	await expect(page.getByTestId('export-auto-confirm')).toHaveCount(0);

	// Zahlungen: the two still without an account.
	await tab('Zahlungen').click();
	await page.getByTestId('filter-without-account').click();
	await expect(page.getByTestId('filter-without-account')).toHaveText('Ohne Konto (2)');
	const rows = page.getByTestId('transaction');
	await expect(rows).toHaveCount(2);
	await expect(rows.first().getByTestId('no-account-badge')).toHaveText('ohne Konto');
	const row = (/** @type {string} */ text) => rows.filter({ hasText: text });
	const detail = page.getByTestId('tx-detail');
	const booking = detail.getByTestId('tx-booking');

	// The expense: its receipt uploaded, the key from its VAT, the account typed.
	await row('KABELNETZ').click();
	await expect(booking).toHaveAttribute('data-confirmed', 'false');
	await expect(booking.getByTestId('tx-booking-suggestion')).toContainText('Kein Vorschlag');
	await detail
		.getByTestId('tx-upload-input')
		.setInputFiles({ name: 'Rechnung-Kabel.pdf', mimeType: 'application/pdf', buffer: kabelPdf });
	await expect(detail.getByTestId('tx-linked-vendor')).toHaveText(KABEL.vendor);
	await expect(booking.getByTestId('tx-booking-key')).toHaveValue('9');
	await expect(booking.getByTestId('tx-booking-tax-via')).toHaveText('Aus dem Beleg: USt 19 %');
	await booking.getByTestId('tx-booking-account').fill('4925');
	await expect(booking.getByTestId('tx-booking-account-name')).toHaveText(
		'Telefax und Internetkosten'
	);
	await booking.getByTestId('tx-booking-confirm').click();
	await expect(booking).toHaveAttribute('data-confirmed', 'true');
	await expect(booking.getByTestId('tx-booking-confirmed')).toContainText(
		'Übernommen: 4925 Telefax und Internetkosten · BU 9'
	);
	await booking.scrollIntoViewIfNeeded();
	await page.screenshot({ path: test.info().outputPath('konto.png') });
	await detail.getByTestId('tx-detail-close').click();
	await expect(rows).toHaveCount(1);

	// The income: no receipt, an Automatikkonto, no key.
	await row(CUSTOMER).click();
	await booking.getByTestId('tx-booking-account').fill('8400');
	await expect(booking.getByTestId('tx-booking-account-name')).toHaveText('Erlöse 19 % USt');
	await booking.getByTestId('tx-booking-key').fill('');
	await booking.getByTestId('tx-booking-confirm').click();
	await expect(booking).toHaveAttribute('data-confirmed', 'true');
	await detail.getByTestId('tx-detail-close').click();
	await expect(page.getByTestId('filter-without-account')).toHaveText('Ohne Konto (0)');

	// The vendor is learned: its next booking is suggested 4925 / 9, "gelernt".
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const [first] = /** @type {any[]} */ (await e2e.accounts()).filter(
			(/** @type {any} */ a) => a.ibanLast4 === '0011'
		);
		await e2e.addTransaction({
			accountId: first.id,
			bookedOn: '2026-10-01',
			counterparty: 'KABELNETZ BEISPIEL',
			purpose: 'Rechnung KB-2026-1001',
			amountCents: -3999,
			currency: 'EUR'
		});
	});
	await expect(page.getByTestId('filter-without-account')).toHaveText('Ohne Konto (1)');
	await rows.first().click();
	await expect(booking.getByTestId('tx-booking-suggestion')).toContainText(
		'4925 Telefax und Internetkosten'
	);
	await expect(booking.getByTestId('tx-booking-source')).toHaveAttribute('data-source', 'learned');
	await expect(booking.getByTestId('tx-booking-source')).toHaveText(`gelernt von ${KABEL.vendor}`);
	await expect(booking.getByTestId('tx-booking-key')).toHaveValue('9');
	await detail.getByTestId('tx-detail-close').click();

	// Export September: ready, with a warning for the income without a receipt.
	await tab('Export').click();
	await page.getByTestId('export-month-select').selectOption(MONTH);
	await expect(check('unassigned')).toHaveAttribute('data-state', 'ok');
	await expect(check('missing-receipt')).toHaveAttribute('data-state', 'warning');
	await expect(check('missing-receipt')).toContainText(CUSTOMER);
	await expect(page.getByTestId('export-summary')).toHaveText(
		'5 Buchungen · 4 im Buchungsstapel · 1 Belege und 2 Kontoauszüge im ZIP'
	);
	await page.screenshot({ path: test.info().outputPath('export.png'), fullPage: true });
	await page.setViewportSize({ width: 375, height: 812 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: test.info().outputPath('export-phone.png'), fullPage: true });
	await page.setViewportSize({ width: 1280, height: 720 });
	// The notice comes first (#1053): no download until it is confirmed, and a
	// report link that carries only the month, the app and the counts.
	const notice = page.getByTestId('export-notice');
	await expect(notice).toContainText('noch in Entwicklung');
	await expect(notice).toContainText('nicht von DATEV zertifiziert');
	await expect(notice).toContainText('belege@le-space.de');
	await expect(page.getByTestId('export-download')).toBeDisabled();
	await expect(page.getByTestId('export-ack-needed')).toBeVisible();
	const report = decodeURIComponent(
		String(await page.getByTestId('export-report').getAttribute('href'))
	);
	expect(report.startsWith('mailto:belege@le-space.de?')).toBe(true);
	expect(report).toContain(`Monat: ${MONTH}`);
	expect(report).toContain('Buchungen: 4');
	for (const leak of [KABEL.vendor, CUSTOMER, '39,99', '119,00', 'MUSTER UG']) {
		expect(report).not.toContain(leak);
	}
	await page.getByTestId('export-ack').check();
	await expect(page.getByTestId('export-download')).toBeEnabled();
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	expect(download.suggestedFilename()).toBe(`DATEV_${MONTH}.zip`);
	await expect(page.getByTestId('export-done')).toHaveText(
		`Heruntergeladen: DATEV_${MONTH}.zip – 4 Buchungen, 1 Belege, 2 Kontoauszüge.`
	);
	const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
	expect(Object.keys(zip).sort()).toEqual([
		`Belege/${MONTH}-001_Kabelnetz_Beispiel_GmbH.pdf`,
		`DATEV/EXTF_Buchungsstapel_${MONTH}.csv`,
		'HINWEIS.txt',
		`Kontoauszuege/KA-${MONTH}-1200_Konto_A_Test.pdf`,
		`Kontoauszuege/KA-${MONTH}-1210_Konto_B_Test.pdf`,
		`Uebersicht_${MONTH}.csv`
	]);
	const readMe = strFromU8(zip['HINWEIS.txt']);
	expect(readMe).toContain('nicht von DATEV zertifiziert');
	expect(readMe).toMatch(new RegExp(`Monat:\\s+${MONTH}`));
	expect(readMe).toMatch(/Hinweis bestätigt am:\s+\d{4}-\d{2}-\d{2}T/);
	expect(readMe).toMatch(/Hinweis-Version:\s+export-1/);
	// Asked again for the next export.
	await expect(page.getByTestId('export-ack')).not.toBeChecked();
	await expect(page.getByTestId('export-download')).toBeDisabled();
	expect(strFromU8(zip[`Kontoauszuege/KA-${MONTH}-1200_Konto_A_Test.pdf`].slice(0, 5))).toBe(
		'%PDF-'
	);
	expect(strFromU8(zip[`Belege/${MONTH}-001_Kabelnetz_Beispiel_GmbH.pdf`].slice(0, 5))).toBe(
		'%PDF-'
	);
	const raw = zip[`DATEV/EXTF_Buchungsstapel_${MONTH}.csv`];
	const csv = new TextDecoder('windows-1252').decode(raw);
	const lines = csv.split('\r\n');
	expect(lines).toHaveLength(2 + 4 + 1);
	expect(lines[6]).toBe('');
	expect(lines[0]).toMatch(
		/^"EXTF";700;21;"Buchungsstapel";13;\d{17};;"";"";;1001;1;20260101;4;20260901;20260930;"Belege 2026-09";"";1;0;0;"EUR";;;;;;;;;$/
	);
	expect(lines[1].split(';')).toHaveLength(125);
	const head = (/** @type {string} */ line) => line.split(';').slice(0, 14).join(';');
	expect(lines.slice(2, 6).map(head)).toEqual([
		`39,99;"H";;;;;1200;4925;"9";0109;"${MONTH}-001";;;"${KABEL.vendor}"`,
		`119,00;"S";;;;;1200;8400;;1509;"KA-${MONTH}-1200";;;"${CUSTOMER}"`,
		`500,00;"H";;;;;1200;1210;;2009;"KA-${MONTH}-1200";;;"MUSTER UG"`,
		`9,90;"H";;;;;1200;4970;;3009;"KA-${MONTH}-1200";;;"Abschluss per Quartalsende"`
	]);
	// Windows-1252: "ö" is one byte, not UTF-8's two.
	expect(raw.includes(0xf6)).toBe(true);
	expect(raw.includes(0xc3)).toBe(false);
	const overview = strFromU8(zip[`Uebersicht_${MONTH}.csv`]);
	expect(overview).toContain(
		`01.09.2026;-39,99;${KABEL.vendor};Konto A Test ···0011;1200;4925;9;${MONTH}-001`
	);
	expect(overview).toContain('nicht im Buchungsstapel');

	// The Verlauf says what went out; a second export gives the same number.
	await page.getByTestId('footer-verlauf').click();
	await page.locator('[data-testid="verlauf-filter"][data-group="entscheidungen"]').click();
	await expect(
		page
			.getByTestId('verlauf-event')
			.filter({ hasText: 'DATEV-Export' })
			.getByTestId('verlauf-text')
	).toHaveText(`DATEV-Export ${MONTH}: 4 Buchungen, 1 Belege`);
	await tab('Export').click();
	await page.getByTestId('export-month-select').selectOption(MONTH);
	// This time without the statements: none in the ZIP, and the page says what that means.
	await page.getByTestId('export-with-statements').uncheck();
	await expect(page.getByTestId('export-without-statements-hint')).toContainText(
		'Belegfeld bei Buchungen ohne eigenen Beleg leer'
	);
	await expect(page.getByTestId('export-summary')).toContainText('0 Kontoauszüge');
	await page.getByTestId('export-ack').check();
	const [again] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	const second = unzipSync(new Uint8Array(await readFile(await again.path())));
	expect(Object.keys(second)).toContain(`Belege/${MONTH}-001_Kabelnetz_Beispiel_GmbH.pdf`);
	expect(Object.keys(second).filter((f) => f.startsWith('Kontoauszuege/'))).toEqual([]);
	// The choice is kept in this browser.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await tab('Export').click();
	await expect(page.getByTestId('export-with-statements')).not.toBeChecked();

	const { text } = await everythingStoredAsText(page);
	for (const secret of [
		KABEL.vendor,
		KABEL.marker,
		CUSTOMER,
		'exportNumber',
		'ledgerAccount',
		'confirmedAt'
	]) {
		expect(text.includes(secret), `${secret} readable at rest`).toBe(false);
	}
});
