// Receipts end to end: a fake mail server (hoodiecrow, synthetic mailbox that
// mixes receipts to the accounting alias with private mail), a fake
// OpenAI-compatible LLM, the real bridge in test mode, and the app.
//
// Passkey → pair → "E-Mails abrufen" lists the accounting mails only → a
// receipt's PDF renders → "Auslesen" fills vendor, amount, date, and the LLM
// never saw the redacted personal data → the phishing look-alike is held back
// until confirmed → upload a PDF, again (duplicate) → reload, still there →
// on disk, no vendor, no marker, no file bytes in plaintext.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	RECEIPTS,
	SECRETS,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { makePdf } from '@belege/bridge/testing/pdf';
import { addVirtualAuthenticator } from './webauthn.js';
import { everythingStoredAsText } from './storage-scan.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

// The receipts lie 1–5 days before this, so this month and the last always hold them.
const BASE = new Date(Date.now() - 2 * 864e5);
const day = (/** @type {number} */ n) => new Date(BASE.getTime() - n * 864e5);
const DATE = new Intl.DateTimeFormat('de-DE', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
	timeZone: 'UTC'
});

const UPLOAD = {
	vendor: 'Hochladetest Lieferant GmbH',
	marker: 'MARKER-UPLOAD-3B9D',
	file: 'Rechnung-Upload.pdf'
};
const uploadPdf = makePdf([
	`Anbieter: ${UPLOAD.vendor}`,
	'Rechnungsnummer: HL-42',
	'Rechnungsdatum: 2026-07-03',
	'Brutto: 42,00 EUR',
	`Kennung: ${UPLOAD.marker}`
]);

/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	imap = await startFakeImap({ storage: sampleMailbox({ base: BASE }) });
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-receipts-'));
	const configPath = join(dir, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			bridge: { port: BRIDGE_PORT },
			appOrigins: [APP_ORIGIN],
			mail: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: 'none',
				accountingAddress: ACCOUNTING
			},
			llm: {
				...defaultConfig().llm,
				baseUrl: llm.url,
				redactTerms: [SECRETS.customerName],
				configured: true
			}
		},
		configPath
	);
	bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
		env: {
			...process.env,
			BELEGE_BRIDGE_TEST_IMAP_PASSWORD: FAKE_IMAP_PASSWORD,
			BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY
		},
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
	await imap?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('mail, preview, extraction, phishing warning, upload, reload, nothing readable at rest', async ({
	page
}) => {
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// Without a paired bridge the page says where to pair.
	await tab('Belege').click();
	await expect(page.getByTestId('receipts-empty')).toBeVisible();
	await expect(page.getByTestId('mail-no-bridge')).toBeVisible();

	await tab('Integrationen').click();
	await page.getByTestId('pairing-code').fill(pairingCode());
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');

	// "E-Mails abrufen": this month and the last, the accounting mails only.
	await tab('Belege').click();
	await expect(page.getByTestId('mail-fetch')).toBeEnabled();
	await page.getByTestId('mail-fetch').click();
	await expect(page.getByTestId('mail-result')).toHaveText(
		'6 E-Mails · neu: 6 · schon vorhanden: 0 · doppelt: 0'
	);
	const receipts = page.getByTestId('receipt');
	await expect(receipts).toHaveCount(6);
	await expect(
		page.locator('[data-testid="receipt-source"][data-source="mail"] [data-testid="source-count"]')
	).toHaveText('6');
	await expect(page.locator('[data-testid="receipt-source"][data-source="mail"]')).toContainText(
		ACCOUNTING
	);
	const content = await page.content();
	for (const privateText of [
		'Privatgeheimnis',
		'Planung.pdf',
		'Freundin',
		'Energie-News',
		'Junkordner',
		'Geloescht',
		'Alte Rechnung'
	]) {
		expect(content.includes(privateText), privateText).toBe(false);
	}
	// A second fetch downloads nothing new.
	await page.getByTestId('mail-fetch').click();
	await expect(page.getByTestId('mail-result')).toHaveText(
		'6 E-Mails · neu: 0 · schon vorhanden: 6 · doppelt: 0'
	);

	// The PDF receipt from the verified sender: preview renders, then "Auslesen".
	const wolke = receipts.filter({ hasText: `Rechnung-${RECEIPTS.wolkenfabrik.invoice}.pdf` });
	await expect(wolke.getByTestId('receipt-status')).toHaveText('Neu');
	await wolke.click();
	const detail = page.getByTestId('receipt-detail');
	await expect(detail.getByTestId('field-verdict')).toHaveText('bestanden');
	const canvas = detail.getByTestId('preview-pdf');
	await expect(canvas).toHaveAttribute('data-rendered', 'true');
	const inked = await canvas.evaluate((/** @type {HTMLCanvasElement} */ c) => {
		const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? [];
		let dark = 0;
		for (let i = 0; i < data.length; i += 4) if (data[i] < 128 && data[i + 3] > 0) dark++;
		return { width: c.width, dark };
	});
	expect(inked.width).toBeGreaterThan(100);
	expect(inked.dark, 'the text of page 1 was drawn').toBeGreaterThan(50);

	await detail.getByTestId('extract').click();
	await expect(detail.getByTestId('field-vendor')).toHaveText(RECEIPTS.wolkenfabrik.vendor);
	await expect(detail.getByTestId('field-amount')).toHaveText(/119,00\sEUR/);
	await expect(detail.getByTestId('field-date')).toHaveText(DATE.format(day(1)));
	await expect(detail.getByTestId('field-invoice')).toHaveText(RECEIPTS.wolkenfabrik.invoice);
	await expect(detail.getByTestId('field-model')).toHaveText('deepseek-flash');
	const read = receipts.filter({ hasText: RECEIPTS.wolkenfabrik.vendor });
	await expect(read.getByTestId('receipt-status')).toHaveText('Nicht zugeordnet');
	await expect(read.getByTestId('receipt-amount')).toHaveText(/119,00\sEUR/);
	await expect(read.getByTestId('receipt-date')).toHaveText(DATE.format(day(1)));

	// What reached the LLM: the PDF's text, redacted by the bridge.
	expect(llm.requests.length).toBe(1);
	const sent = llm.requests.map((r) => r.raw).join('\n');
	expect(sent).toContain(RECEIPTS.wolkenfabrik.invoice);
	for (const secret of [
		SECRETS.customerName,
		SECRETS.iban,
		SECRETS.iban.replace(/\s/g, ''),
		SECRETS.street,
		SECRETS.postcode,
		SECRETS.ownMail
	]) {
		expect(sent.includes(secret), `${secret} reached the LLM`).toBe(false);
	}

	// The phishing look-alike: a warning, no preview, no "Auslesen" – until confirmed.
	const phish = receipts.filter({ has: page.getByTestId('receipt-unverified') }).filter({
		hasText: RECEIPTS.phishing.vendor
	});
	await expect(phish).toHaveCount(1);
	await expect(phish.getByTestId('receipt-status')).toHaveText('Rückfrage');
	await phish.click();
	await expect(detail.getByTestId('sender-warning')).toContainText('nicht bestanden');
	await expect(detail.getByTestId('preview-pdf')).toHaveCount(0);
	await expect(detail.getByTestId('extract')).toHaveCount(0);
	await expect(detail.getByTestId('field-verdict')).toHaveText('nicht bestanden');
	await detail.getByTestId('confirm-sender').click();
	await expect(detail.getByTestId('sender-warning')).toHaveCount(0);
	await expect(detail.getByTestId('preview-pdf')).toHaveAttribute('data-rendered', 'true');
	await expect(detail.getByTestId('extract')).toBeVisible();

	// Our own forward from Sent needs no confirmation; the order mail shows its text.
	await receipts.filter({ hasText: 'Beleg-Buero.pdf' }).click();
	await expect(detail.getByTestId('field-verdict')).toHaveText('eigene E-Mail (Gesendet)');
	await expect(detail.getByTestId('sender-warning')).toHaveCount(0);
	await receipts.filter({ hasText: RECEIPTS.papierladen.vendor }).click();
	await expect(detail.getByTestId('preview-text')).toContainText(
		`Summe: ${RECEIPTS.papierladen.gross} EUR`
	);
	await receipts.filter({ hasText: 'quittung.jpg' }).click();
	await expect(detail.getByTestId('preview-image')).toBeVisible();
	await expect(detail.getByTestId('extract-note')).toHaveText(
		'Bild – Auslesen folgt (noch keine Texterkennung).'
	);

	// Upload a PDF; the same bytes again are a duplicate.
	await page
		.getByTestId('receipt-upload')
		.setInputFiles({ name: UPLOAD.file, mimeType: 'application/pdf', buffer: uploadPdf });
	await expect(page.getByTestId('import-result')).toHaveText(
		'Neu: 1 · doppelt: 0 · nicht unterstützt: 0'
	);
	await page
		.getByTestId('receipt-upload')
		.setInputFiles({ name: 'nochmal.pdf', mimeType: 'application/pdf', buffer: uploadPdf });
	await expect(page.getByTestId('import-result')).toHaveText(
		'Neu: 0 · doppelt: 1 · nicht unterstützt: 0'
	);
	await expect(receipts).toHaveCount(7);
	const uploaded = receipts.filter({ hasText: UPLOAD.file });
	await expect(uploaded).toHaveAttribute('data-source', 'upload');
	await expect(
		page.locator('[data-testid="receipt-month"][data-month="ohne"]').getByTestId('receipt')
	).toHaveCount(1);
	await page.locator('[data-testid="receipt-source"][data-source="upload"]').click();
	await expect(receipts).toHaveCount(1);
	await page.locator('[data-testid="receipt-source"][data-source="all"]').click();

	// Search by amount and by vendor.
	await page.getByTestId('receipt-search').fill('119,00');
	await expect(receipts).toHaveCount(1);
	await page.getByTestId('receipt-search').fill('');

	// After a reload: everything is still there, and the upload's preview renders.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await tab('Belege').click();
	await expect(receipts).toHaveCount(7);
	await receipts.filter({ hasText: UPLOAD.file }).click();
	await expect(detail.getByTestId('preview-pdf')).toHaveAttribute('data-rendered', 'true');
	await expect(
		receipts.filter({ hasText: RECEIPTS.wolkenfabrik.vendor }).getByTestId('receipt-status')
	).toHaveText('Nicht zugeordnet');
	// On a phone: no sideways scrolling, the list and the detail stacked.
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(detail.getByTestId('preview-pdf')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: test.info().outputPath('belege-phone.png'), fullPage: true });
	await page.setViewportSize({ width: 1280, height: 720 });

	await tab('Home').click();
	await expect(page.getByTestId('count-receipts')).toHaveText('7');

	// At rest: records and files are there, but no vendor, subject, marker or file byte is readable.
	const { inventory, text } = await everythingStoredAsText(page);
	expect(inventory.reduce((sum, db) => sum + db.records, 0)).toBeGreaterThan(0);
	const pdfHead = Buffer.from(uploadPdf.subarray(0, 48)).toString('hex');
	for (const secret of [
		RECEIPTS.wolkenfabrik.vendor,
		RECEIPTS.wolkenfabrik.marker,
		RECEIPTS.wolkenfabrik.invoice,
		RECEIPTS.stromwerk.vendor,
		RECEIPTS.stromwerk.marker,
		RECEIPTS.buero.marker,
		RECEIPTS.papierladen.vendor,
		UPLOAD.vendor,
		UPLOAD.marker,
		UPLOAD.file,
		'Ihre Rechnung',
		'wolkenfabrik.example',
		SECRETS.customerName,
		'%PDF-1.4',
		pdfHead
	]) {
		expect(text.includes(secret), `${secret} readable at rest`).toBe(false);
	}
});
