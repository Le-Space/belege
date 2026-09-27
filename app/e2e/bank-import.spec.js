// Bank import end to end: a fake Hibiscus (HTTPS, self-signed, two accounts
// of which one is filtered out), the real bridge in test mode, and the app.
//
// Passkey → pair with the code the bridge prints → sync → Zahlungen grouped
// by month and day → a second sync adds nothing → CAMT.053 upload adds the
// Revolut-style account → on disk, no counterparty and no token in plaintext.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { makePdf } from '@belege/bridge/testing/pdf';
import { addVirtualAuthenticator } from './webauthn.js';
import { everythingStoredAsText } from './storage-scan.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));
const REVOLUT = fileURLToPath(
	new URL('../src/lib/bank/fixtures/camt053-revolut.xml', import.meta.url)
);

/** @param {Date} d */
const iso = (d) => d.toISOString().slice(0, 10);
const DAY = new Intl.DateTimeFormat('de-DE', {
	weekday: 'long',
	day: 'numeric',
	month: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});
const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });

// Inside the first sync's 90 days whenever this runs: two bookings on one day,
// one 35 days earlier (so always in an earlier month).
const recent = iso(new Date(Date.now() - 3 * 864e5));
const earlier = iso(new Date(Date.now() - 38 * 864e5));

const names = {
	debit: 'Kaffeerösterei Nordlicht GmbH',
	credit: 'Kundin Beispiel AG',
	older: 'Softwareabo Muster Ltd',
	privateAccount: 'Privatkonto Geheim',
	privatePayee: 'Privater Empfänger Geheim',
	revolutDebit: 'Wolkenspeicher Testdienst Ltd',
	revolutCredit: 'Umbuchung Eigenkonto Test'
};

function fakeData() {
	const data = sampleData();
	const [a, b, c, d] = data.transactions;
	a.datum = a.valuta = recent;
	b.datum = b.valuta = recent;
	c.datum = c.valuta = earlier;
	d.datum = d.valuta = recent;
	return data;
}

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: fakeData() });
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-bridge-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			hibiscus: {
				host: hibiscus.host,
				port: hibiscus.port,
				certSha256: hibiscus.fingerprint,
				ibanSuffixes: ['4711']
			},
			llm: { ...defaultConfig().llm, baseUrl: llm.url, configured: true }
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY
		},
		stdio: ['ignore', 'pipe', 'pipe']
	});
	bridge.stdout?.on('data', (d) => (bridgeOut += d));
	bridge.stderr?.on('data', (d) => (bridgeOut += d));
	await expect.poll(() => bridgeOut, { timeout: 15_000 }).toMatch(/Pairing code/);
});

test.afterAll(async () => {
	bridge?.kill('SIGTERM');
	await hibiscus?.close();
	await llm?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('pair, sync from Hibiscus, see Zahlungen, re-sync adds nothing, import CAMT', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// Pair: the code from the bridge's console becomes a token in the sealed store.
	await page.getByRole('link', { name: 'Integrationen' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('Bridge erreichbar');
	await expect(page.getByTestId('bridge-status')).toContainText('nicht gekoppelt');
	await page.getByTestId('pairing-code').fill(pairingCode());
	const pairResponse = page.waitForResponse((r) => r.url().endsWith('/pair'));
	await page.getByRole('button', { name: 'Koppeln' }).click();
	const token = (await (await pairResponse).json()).token;
	expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	// Only the allowed account shows, masked; the private one never reaches the page.
	const accounts = page.getByTestId('hibiscus-account');
	await expect(accounts).toHaveCount(1);
	await expect(accounts.first()).toContainText('DE00 **** 4711');
	await expect(accounts.first()).toContainText('Geschäftskonto Test');
	expect(await page.content()).not.toContain(names.privateAccount);

	// First sync: three bookings.
	await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
	await expect(page.getByTestId('sync-result')).toHaveText(
		'Neu: 3 · Aktualisiert: 0 · Übersprungen: 0'
	);

	// Zahlungen: months newest first with counts; days as headings; amounts German.
	await page.getByRole('link', { name: 'Zahlungen' }).click();
	const months = page.getByTestId('transaction-month');
	await expect(months).toHaveCount(2);
	await expect(months.nth(0)).toContainText(MONTH.format(new Date(`${recent}T00:00:00Z`)));
	await expect(months.nth(0).getByTestId('month-count')).toHaveText('2');
	await expect(months.nth(1).getByTestId('month-count')).toHaveText('1');
	await expect(months.nth(0).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
	await expect(page.getByTestId('filter-without-receipt')).toHaveText('Nur ohne Beleg (3)');
	await expect(page.getByTestId('filter-all')).toHaveText('Alle (3)');

	const day = page.getByTestId('transaction-day');
	await expect(day).toHaveCount(1);
	await expect(day.getByRole('heading')).toHaveText(DAY.format(new Date(`${recent}T00:00:00Z`)));
	const debit = page.getByTestId('transaction').filter({ hasText: names.debit });
	await expect(debit.getByTestId('amount')).toHaveText(/-22,42\sEUR/);
	await expect(debit.getByTestId('amount')).toHaveClass(/text-red-700/);
	await expect(debit.getByTestId('account-badge')).toHaveText('Hibiscus ···4711');
	const credit = page.getByTestId('transaction').filter({ hasText: names.credit });
	await expect(credit.getByTestId('amount')).toHaveText(/1\.439,76\sEUR/);
	await expect(credit.getByTestId('amount')).toHaveClass(/text-emerald-700/);

	await months.nth(1).click();
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toContainText(names.older);
	await expect(page.getByTestId('transaction')).toContainText('-7,47');

	// Search by amount and by name, across months.
	await page.getByTestId('transaction-search').fill('1439,76');
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toContainText(names.credit);
	await page.getByTestId('transaction-search').fill('nordlicht');
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await page.getByTestId('transaction-search').fill('');

	// The private account's transactions were never asked for.
	expect(
		hibiscus.requests.filter(
			(r) => r.method === 'hibiscus.xmlrpc.umsatz.list' && JSON.stringify(r.params).includes('"2"')
		)
	).toEqual([]);

	// After a reload: the token comes back from the sealed store, and a second
	// sync adds nothing.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await page.getByRole('link', { name: 'Integrationen' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
	await expect(page.getByTestId('hibiscus-account')).toHaveCount(1);
	// It asks from a week before the last sync: the two recent bookings come
	// again and are known; the older one is outside that window.
	await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
	await expect(page.getByTestId('sync-result')).toHaveText(
		'Neu: 0 · Aktualisiert: 0 · Übersprungen: 2'
	);

	// CAMT.053 from Revolut: a second account, two booked entries, one pending left out.
	await page.getByTestId('camt-file').setInputFiles(REVOLUT);
	await expect(page.getByTestId('camt-result')).toHaveText(
		'Revolut Testkonto ···0001: Neu: 2 · Aktualisiert: 0 · Übersprungen: 0 · 1 vorgemerkt (nicht importiert)'
	);
	await page.getByTestId('camt-file').setInputFiles(REVOLUT);
	await expect(page.getByTestId('camt-result')).toContainText(
		'Neu: 0 · Aktualisiert: 0 · Übersprungen: 2'
	);
	await expect(page.getByTestId('book-account')).toHaveCount(2);

	await page.getByRole('link', { name: 'Home' }).click();
	await expect(page.getByTestId('count-transactions')).toHaveText('5');

	await page.getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('account-filter').selectOption({ label: 'Revolut Testkonto ···0001' });
	await expect(page.getByTestId('filter-all')).toHaveText('Alle (2)');
	await page.locator('[data-testid="transaction-month"][data-month="2026-09"]').click();
	await expect(page.getByTestId('transaction')).toHaveCount(2);
	await expect(
		page.getByTestId('transaction').filter({ hasText: names.revolutDebit }).getByTestId('amount')
	).toHaveText(/-19,99\sEUR/);
	await expect(
		page.getByTestId('transaction').filter({ hasText: names.revolutDebit })
	).toContainText('CAMT ···0001');

	// "Als Gegenbuchung verknüpfen …": the other side by hand, on another
	// account and the other way; neither needs a receipt, each names the other.
	await page.getByTestId('transaction').filter({ hasText: names.revolutDebit }).click();
	const detail = page.getByTestId('tx-detail');
	await detail.getByTestId('tx-alt-toggle').click();
	await detail.getByTestId('tx-link-transfer').click();
	const choices = detail.getByTestId('tx-link-transfer-choice');
	await expect(choices).toHaveCount(1);
	await expect(choices).toContainText(names.credit);
	// ✦ KI-Vorschlag: only a suggestion, redacted, no IBAN; linked on the click.
	llm.answers.respond = (/** @type {any} */ body) =>
		String(body.messages[0].content).startsWith('You help a German company')
			? { best: 1, confidence: 'medium', reason: 'Gleiche Zeit, eigenes Konto' }
			: undefined;
	await detail.getByTestId('tx-link-transfer-ai').click();
	const aiResult = detail.getByTestId('tx-link-transfer-ai-result');
	await expect(aiResult).toContainText(
		'KI-Vorschlag (wahrscheinlich): Gleiche Zeit, eigenes Konto'
	);
	await expect(aiResult).toContainText(names.credit);
	await expect(detail.getByTestId('tx-why-rule')).toHaveCount(0);
	const asked = llm.requests.at(-1)?.body.messages[1].content ?? '';
	expect(asked).toContain('Ausgang');
	expect(asked).not.toContain('DE00000000000000004711');
	await detail.getByTestId('tx-link-transfer-ai-take').click();
	await expect(detail.getByTestId('tx-why-rule-line')).toContainText('von dir verknüpft');
	await expect(detail.getByTestId('tx-related-chip')).toContainText(/1\.439,76\sEUR/);
	await expect(detail.getByTestId('tx-related-chip')).toContainText('von dir verknüpft');
	// "Verknüpfung lösen": a receipt is needed again.
	await expect(detail.getByTestId('tx-not-transfer')).toHaveText('Verknüpfung lösen – Beleg nötig');
	await detail.getByTestId('tx-not-transfer').click();
	await expect(detail.getByTestId('tx-why-rule')).toHaveCount(0);
	await expect(detail.getByTestId('tx-related-chip')).toHaveCount(0);
	await detail.getByTestId('tx-detail-close').click();

	// "Umbuchung mit Beleg": a payment that has a receipt, then becomes an own
	// transfer, shows on Home until the receipt is unlinked (or kept).
	await page.getByTestId('transaction').filter({ hasText: names.revolutDebit }).click();
	await detail.getByTestId('tx-upload-input').setInputFiles({
		name: 'Rechnung-Wolke.pdf',
		mimeType: 'application/pdf',
		buffer: makePdf([
			`Anbieter: ${names.revolutDebit}`,
			'Rechnungsnummer: WS-2026-0918',
			'Rechnungsdatum: 2026-09-18',
			'Brutto: 19,99 EUR'
		])
	});
	await expect(detail.getByTestId('tx-upload-result')).toContainText('Zugeordnet');
	await detail.getByTestId('tx-detail-close').click();
	await page.getByTestId('account-filter').selectOption('');
	await page.locator('[data-testid="transaction-month"][data-month="2026-09"]').click();
	await page.getByTestId('transaction').filter({ hasText: names.credit }).click();
	await detail.getByTestId('tx-alt-toggle').click();
	await detail.getByTestId('tx-link-transfer').click();
	await detail
		.getByTestId('tx-link-transfer-choice')
		.filter({ hasText: /-19,99\sEUR/ })
		.getByTestId('tx-link-transfer-pick')
		.click();
	await expect(detail.getByTestId('tx-why-rule-line')).toContainText('von dir verknüpft');
	await detail.getByTestId('tx-detail-close').click();
	await page.getByRole('link', { name: 'Home' }).click();
	const check = page.getByTestId('transfer-receipts');
	await expect(check).toContainText('Umbuchung mit Beleg: 1 zu prüfen');
	await expect(check.getByTestId('transfer-receipt')).toContainText(names.revolutDebit);
	await check.getByTestId('transfer-receipt-unlink').click();
	await expect(check).toHaveCount(0);
	await page.getByRole('link', { name: 'Zahlungen' }).click();

	// A card charge and its refund (issue #119): a second card account with the
	// same charge as the Revolut one, so the refund has two charges to choose
	// from and no automatic pair is guessed; linked by hand as a refund.
	const card = readFileSync(REVOLUT, 'utf8')
		.replaceAll('LT000000000000000001', 'LT000000000000000002')
		.replaceAll('Revolut Testkonto', 'Karte Testkonto')
		.replaceAll('rev-', 'card-')
		.replaceAll('REV-', 'CARD-')
		.replace('<Amt Ccy="EUR">1500.00</Amt>', '<Amt Ccy="EUR">19.99</Amt>')
		.replace('<Amt Ccy="EUR">1500.00</Amt>', '<Amt Ccy="EUR">19.99</Amt>')
		.replaceAll('2026-09-10', '2026-09-25')
		.replace('Umbuchung Eigenkonto Test', 'Rückerstattung Wolkenspeicher Testdienst Ltd')
		.replace('DE00000000000000004711', 'DE00000000000000008888');
	await page.getByRole('link', { name: 'Integrationen' }).click();
	await page.getByTestId('camt-file').setInputFiles({
		name: 'karte.xml',
		mimeType: 'application/xml',
		buffer: Buffer.from(card, 'utf8')
	});
	await expect(page.getByTestId('camt-result')).toContainText('Karte Testkonto ···0002: Neu: 2');
	await page.getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('account-filter').selectOption('');
	await page.getByTestId('filter-all').click();
	await page.locator('[data-testid="transaction-month"][data-month="2026-09"]').click();
	await page
		.getByTestId('transaction')
		.filter({ hasText: 'Rückerstattung Wolkenspeicher' })
		.click();
	await expect(detail.getByTestId('tx-why-rule')).toHaveCount(0);
	await detail.getByTestId('tx-alt-toggle').click();
	await detail.getByTestId('tx-link-refund').click();
	await detail
		.getByTestId('tx-link-transfer-choice')
		.filter({ hasText: 'Karte Testkonto' })
		.filter({ hasText: /-19,99\sEUR/ })
		.getByTestId('tx-link-transfer-pick')
		.click();
	await expect(detail.getByTestId('tx-why-rule-line')).toContainText('Erstattung zur Belastung');
	await expect(detail.getByTestId('tx-why-rule-line')).toContainText('von dir verknüpft');
	await expect(detail.getByTestId('tx-related-chip')).toContainText('Erstattung');
	await detail.getByTestId('tx-detail-close').click();

	// At rest: the bookings are there (the scan finds data) but no counterparty,
	// no purpose and no token is readable; the token is not in localStorage at all.
	const { inventory, text } = await everythingStoredAsText(page);
	expect(inventory.reduce((sum, db) => sum + db.records, 0)).toBeGreaterThan(0);
	for (const secret of [
		...Object.values(names),
		'Rechnung KR-2026-0917',
		'Kartenzahlung Wolkenspeicher Abo',
		'LT000000000000000001',
		token
	]) {
		expect(text.includes(secret), `${secret} readable at rest`).toBe(false);
	}
	const local = await page.evaluate(() => JSON.stringify({ ...localStorage }));
	expect(local.includes(token)).toBe(false);
	expect(local.includes(token.slice(0, 16))).toBe(false);

	// "Kopplung lösen" also kills the token on the bridge, not just in the browser.
	await page.getByRole('link', { name: 'Integrationen' }).click();
	await page.getByTestId('unpair').click();
	await expect(page.getByTestId('pairing-code')).toBeVisible();
	await expect(page.getByTestId('bridge-error')).toHaveCount(0);
	const stale = await page.request.get(`http://127.0.0.1:${BRIDGE_PORT}/hibiscus/accounts`, {
		headers: { authorization: `Bearer ${token}` }
	});
	expect(stale.status()).toBe(401);
});
