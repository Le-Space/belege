// Kontierung and the monthly DATEV export end to end: a fake LLM, the real
// bridge in test mode (for reading an uploaded receipt), the app.
//
// Two bank accounts (Konto A ···0011, Konto B ···0022) and their ledger accounts
// under Eigene Anweisungen → a month with an expense, an income, a transfer
// between the two accounts and a bank fee → the export is blocked until
// every booking has a confirmed account → the automatic ones in one click,
// the expense (receipt uploaded, BU key 9 from its VAT) and the income by
// hand → the vendor is learned for its next booking → export: the ZIP is
// read here and its Buchungsstapel checked line by line → the Verlauf →
// nothing readable at rest.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { makePdf } from '@belege/bridge/testing/pdf';
import { addVirtualAuthenticator } from './webauthn.js';
import { everythingStoredAsText } from './storage-scan.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

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
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-export-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: { ...process.env, BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY },
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	if (bridge && bridge.exitCode === null) {
		const exited = new Promise((resolve) => bridge.once('exit', resolve));
		bridge.kill('SIGTERM');
		await exited;
	}
	await llm?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

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
	await page.getByTestId('pairing-code').fill(pairingCode());
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

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

	// Eigene Anweisungen: the ledger accounts, suggested 1200 and 1210 as placeholders only.
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

	await tab('Integrationen').click();
	await ledger('0011').fill('1200');
	await ledger('0022').fill('1210');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();

	// The transfer (both sides) and the fee: one click takes their automatic accounts.
	await tab('Export').click();
	await expect(check('ledger')).toHaveAttribute('data-state', 'ok');
	await expect(page.getByTestId('export-auto-confirm')).toHaveText(
		'Konten aus Umbuchung und Bankgebühr übernehmen (3)'
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
		'5 Buchungen · 4 im Buchungsstapel · 1 Belege im ZIP'
	);
	await page.screenshot({ path: test.info().outputPath('export.png'), fullPage: true });
	await page.setViewportSize({ width: 375, height: 812 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: test.info().outputPath('export-phone.png'), fullPage: true });
	await page.setViewportSize({ width: 1280, height: 720 });
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	expect(download.suggestedFilename()).toBe(`DATEV_${MONTH}.zip`);
	await expect(page.getByTestId('export-done')).toHaveText(
		`Heruntergeladen: DATEV_${MONTH}.zip – 4 Buchungen, 1 Belege.`
	);
	const zip = unzipSync(new Uint8Array(await readFile(await download.path())));
	expect(Object.keys(zip).sort()).toEqual([
		`Belege/${MONTH}-001_Kabelnetz_Beispiel_GmbH.pdf`,
		`DATEV/EXTF_Buchungsstapel_${MONTH}.csv`,
		`Uebersicht_${MONTH}.csv`
	]);
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
		`119,00;"S";;;;;1200;8400;;1509;;;;"${CUSTOMER}"`,
		'500,00;"H";;;;;1200;1210;;2009;;;;"MUSTER UG"',
		'9,90;"H";;;;;1200;4970;;3009;;;;"Abschluss per Quartalsende"'
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
	const [again] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-download').click()
	]);
	const second = unzipSync(new Uint8Array(await readFile(await again.path())));
	expect(Object.keys(second)).toContain(`Belege/${MONTH}-001_Kabelnetz_Beispiel_GmbH.pdf`);

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
