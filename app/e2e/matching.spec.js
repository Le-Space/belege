// Matching end to end: a fake Hibiscus, a fake mail server (the synthetic
// mailbox plus a receipt billed to the personal address), a fake LLM, the
// real bridge in test mode, and the app.
//
// Eigene Anweisungen (company name) → sync six bookings → fetch and read the
// accounting mails → the sure pair is matched, the own transfer and the bank
// fee need no receipt, the unsure one is a question; the bookings without a
// receipt are two days old and wait (grace period 7 days) → grace 0: they
// become questions → answer on Rückfragen →
// coverage per month → detail view: undo a link, link by hand → search the
// private mailbox for the missing one, import the hit, it matches → the
// receipt links back to its booking → "Abgleich starten" changes nothing →
// nothing readable at rest.
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	RECEIPTS,
	SECRETS,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { addVirtualAuthenticator } from './webauthn.js';
import { everythingStoredAsText } from './storage-scan.js';
import { acceptConsent } from './consent.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

// The receipts lie 1–5 days before BASE; every booking is on BASE.
const BASE = new Date(Date.now() - 2 * 864e5);
const booked = BASE.toISOString().slice(0, 10);
const month = booked.slice(0, 7);

const COMPANY = 'le space UG';
const NAMES = {
	wolke: RECEIPTS.wolkenfabrik.vendor,
	strom: RECEIPTS.stromwerk.vendor,
	mobil: RECEIPTS.mobilfunk.vendor,
	coffee: 'Kaffeerösterei Nordlicht GmbH',
	own: 'LE SPACE UG (HAFTUNGSBESCHRAENKT)'
};
const NO_RECEIPT_REASON = 'Bewirtung Kundentermin, Beleg verloren';

function bankData() {
	const data = sampleData();
	/** @param {number} id @param {string} betrag @param {string} name @param {string} zweck @param {string} [art] */
	const u = (id, betrag, name, zweck, art = 'Basislastschrift') => ({
		id,
		konto_id: 1,
		datum: booked,
		valuta: booked,
		betrag,
		empfaenger_name: name,
		empfaenger_konto: '',
		zweck,
		zweck_raw: zweck,
		art,
		endtoendid: ''
	});
	data.transactions = [
		u(301, '-119,00', NAMES.wolke, `SVWZ+Rechnung ${RECEIPTS.wolkenfabrik.invoice} SecureGo plus`),
		u(302, '-52,59', NAMES.strom, 'SVWZ+Abschlag Vertrag 123'),
		u(303, '-39,99', NAMES.mobil, `SVWZ+Rechnung ${RECEIPTS.mobilfunk.invoice}`),
		u(304, '-22,42', NAMES.coffee, 'SVWZ+Kartenzahlung'),
		u(305, '-500,00', NAMES.own, 'SVWZ+Umbuchung Revolut', 'Überweisungsauftrag'),
		u(306, '-9,90', '', 'Abschluss per Quartalsende', 'Abschluss')
	];
	return data;
}

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: bankData() });
	imap = await startFakeImap({ storage: sampleMailbox({ base: BASE, privateReceipt: true }) });
	llm = await startFakeLlm();
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-matching-'));
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
			BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
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
	await hibiscus?.close();
	if (dir) await rm(dir, { recursive: true, force: true });
});

function pairingCode() {
	const m = /Pairing code[^:]*: (\S+)/.exec(bridgeOut);
	if (!m) throw new Error(`no pairing code in the bridge output:\n${bridgeOut}`);
	return m[1];
}

test('matches, asks, covers, links by hand, finds the missing receipt in the private mailbox', async ({
	page
}) => {
	test.setTimeout(240_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await expect(page.getByTestId('agent-open')).toContainText('Keine offenen Rückfragen');

	// Pair, tell the matcher who we are, sync.
	await tab('Integrationen').click();
	await page.getByTestId('pairing-code').fill(pairingCode());
	await page.getByRole('button', { name: 'Koppeln' }).click();
	await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
	await page.getByTestId('company-names').fill(COMPANY);
	await page.getByTestId('rule-contains').fill('Finanzamt');
	await page.getByTestId('rule-reason').fill('Bescheid liegt vor');
	await page.getByTestId('rule-add').click();
	await expect(page.getByTestId('rule')).toHaveCount(1);
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
	await expect(page.getByTestId('sync-result')).toHaveText(
		'Neu: 6 · Aktualisiert: 0 · Übersprungen: 0'
	);

	// Receipts: fetch the accounting mails, read them all.
	await tab('Belege').click();
	await page.getByTestId('mail-fetch').click();
	await expect(page.getByTestId('mail-result')).toHaveText(
		'6 E-Mails · neu: 6 · schon vorhanden: 0 · doppelt: 0'
	);
	await page.getByTestId('extract-all').click();
	const receipts = page.getByTestId('receipt');
	const wolke = receipts.filter({ hasText: NAMES.wolke });
	await expect(wolke.getByTestId('receipt-status')).toHaveText('Zugeordnet');
	await expect(receipts.filter({ hasText: NAMES.strom }).getByTestId('receipt-status')).toHaveText(
		'Nicht zugeordnet'
	);
	await expect(page.getByTestId('extract-all')).toHaveCount(0);
	expect(llm.requests.length).toBe(4);

	// Home: the agent asks about the receipts; the two-day-old bookings without
	// one wait (grace period, default 7 days) instead of asking.
	await tab('Home').click();
	await expect(page.getByTestId('agent-open')).toHaveText('2 offene Rückfragen');
	await expect(page.getByTestId('agent-progress')).toHaveText('0 von 2 erledigt');
	await expect(page.getByTestId('coverage-percent')).toHaveText('50 %');
	await tab('Zahlungen').click();
	await page.getByTestId('filter-all').click();
	const waitingRow = page.getByTestId('transaction').filter({ hasText: NAMES.mobil });
	await expect(waitingRow.getByTestId('waiting-badge')).toHaveText(/^wartet noch \(\d Tage\)$/);
	await waitingRow.click();
	await expect(page.getByTestId('tx-waiting')).toContainText('wartet noch');
	await page.getByTestId('tx-detail-close').click();

	// Eigene Anweisungen: ask at once.
	await tab('Integrationen').click();
	await expect(page.getByTestId('grace-days')).toHaveValue('7');
	await page.getByTestId('grace-days').fill('0');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();
	await tab('Home').click();
	await expect(page.getByTestId('agent-open')).toHaveText('4 offene Rückfragen');
	await expect(page.getByTestId('agent-progress')).toHaveText('0 von 4 erledigt');
	await expect(page.getByTestId('coverage-percent')).toHaveText('50 %');

	// Rückfragen: the Stromwerk receipt fits one booking, but only at 70 points.
	await page.getByTestId('agent-answer').click();
	const questions = page.getByTestId('question');
	await expect(questions).toHaveCount(4);
	await page.screenshot({ path: test.info().outputPath('rueckfragen.png'), fullPage: true });
	const unsure = page.locator('[data-testid="question"][data-kind="unsure-match"]');
	await expect(unsure).toHaveCount(1);
	await expect(unsure.getByTestId('question-receipt')).toHaveText(NAMES.strom);
	await expect(unsure.getByTestId('candidate')).toHaveCount(1);
	await expect(unsure.getByTestId('candidate')).toContainText('70 Punkte');
	await expect(unsure.getByTestId('candidate')).toContainText('Betrag · Anbieter · Datum');
	await unsure.getByTestId('answer-candidate').click();
	await expect(questions).toHaveCount(3);
	// The coffee: no receipt needed, with a reason.
	const coffee = questions.filter({ hasText: NAMES.coffee });
	await coffee.getByTestId('answer-no-receipt').click();
	await coffee.getByTestId('answer-reason').fill(NO_RECEIPT_REASON);
	await coffee.getByRole('button', { name: 'Speichern' }).click();
	await expect(questions).toHaveCount(2);
	await expect(page.locator('[data-testid="question"][data-kind="unknown-sender"]')).toHaveCount(1);
	await tab('Home').click();
	await expect(page.getByTestId('agent-progress')).toHaveText('2 von 4 erledigt');
	await expect(page.getByTestId('coverage-percent')).toHaveText('83 %');

	// Zahlungen: coverage and badges are real.
	await tab('Zahlungen').click();
	const monthButton = page.locator(`[data-testid="transaction-month"][data-month="${month}"]`);
	await expect(monthButton.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '83');
	await expect(monthButton).toContainText('83 % mit Beleg');
	await expect(page.getByTestId('filter-without-receipt')).toHaveText('Nur ohne Beleg (1)');
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toContainText(NAMES.mobil);
	await page.getByTestId('filter-all').click();
	const row = (/** @type {string} */ text) =>
		page.getByTestId('transaction').filter({ hasText: text });
	await expect(row(NAMES.wolke).getByTestId('coverage-badge')).toHaveText('Beleg');
	await expect(row(NAMES.strom).getByTestId('coverage-badge')).toHaveText('Beleg');
	await expect(row(NAMES.own).getByTestId('coverage-badge')).toHaveText('Eigene Umbuchung');
	await expect(row('Abschluss per Quartalsende').getByTestId('coverage-badge')).toHaveText(
		'Kontoauszug'
	);
	await expect(row(NAMES.coffee).getByTestId('coverage-badge')).toHaveText('Kein Beleg nötig');
	await expect(row(NAMES.mobil).getByTestId('coverage-badge')).toHaveCount(0);
	// The TAN method is not part of the purpose shown.
	await expect(row(NAMES.wolke).getByTestId('purpose')).toHaveText(
		`Rechnung ${RECEIPTS.wolkenfabrik.invoice}`
	);

	// Detail: the linked receipt with its preview; undo it, then link it by hand.
	await row(NAMES.wolke).click();
	const detail = page.getByTestId('tx-detail');
	await expect(detail.getByTestId('tx-detail-counterparty')).toHaveText(NAMES.wolke);
	await expect(detail.getByTestId('tx-detail-purpose')).toContainText('SecureGo plus');
	await expect(detail.getByTestId('tx-linked-vendor')).toHaveText(NAMES.wolke);
	await expect(detail.getByTestId('tx-linked-state')).toContainText('automatisch · 120 Punkte');
	// Why: in words, from the stored reasons and points – not the AI's doing.
	await expect(detail.getByTestId('tx-why-line')).toHaveText(
		`Betrag gleich (-119,00\u00a0EUR) · Rechnungsnummer ${RECEIPTS.wolkenfabrik.invoice} im Verwendungszweck · Anbieter ${NAMES.wolke} · Datum passt – 120 Punkte, automatisch zugeordnet`
	);
	await expect(detail.getByTestId('tx-why')).toContainText('nicht die KI');
	await expect(detail.getByTestId('tx-receipt-preview')).toHaveAttribute('data-rendered', 'true');
	await detail.getByTestId('tx-unlink').click();
	await expect(detail.getByTestId('tx-detail-missing')).toBeVisible();
	await expect(page.getByTestId('filter-without-receipt')).toHaveText('Nur ohne Beleg (2)');
	await expect(monthButton.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
	await detail.getByTestId('tx-assign').click();
	const first = detail.getByTestId('tx-choice').first();
	await expect(first).toContainText(NAMES.wolke);
	await expect(first).toHaveAttribute('data-suggested', 'true');
	await first.getByTestId('tx-choose').click();
	await expect(detail.getByTestId('tx-linked-state')).toContainText('bestätigt');
	await expect(detail.getByTestId('tx-why-line')).toContainText('120 Punkte, von dir bestätigt');
	await expect(page.getByTestId('filter-without-receipt')).toHaveText('Nur ohne Beleg (1)');
	await detail.getByTestId('tx-detail-close').click();
	await expect(detail).toHaveCount(0);

	// No receipt needed, and the rule that says so.
	await row(NAMES.own).click();
	await expect(detail.getByTestId('tx-why-rule-line')).toHaveText(
		`Eigene Umbuchung: Die Gegenpartei ist deine Firma „${COMPANY}“`
	);
	await detail.getByTestId('tx-detail-close').click();
	await row('Abschluss per Quartalsende').click();
	await expect(detail.getByTestId('tx-why-rule-line')).toHaveText(
		'Bankentgelt: Buchungsart „Abschluss“ – der Kontoauszug ist der Beleg'
	);
	await detail.getByTestId('tx-detail-close').click();

	// The missing one: search the private mailbox, only on this click.
	await row(NAMES.mobil).click();
	await expect(detail.getByTestId('tx-detail-missing')).toBeVisible();
	// Its open question, with what came close (nothing did).
	await expect(detail.getByTestId('tx-why-question')).toBeVisible();
	await expect(detail.getByTestId('tx-private-hint')).toContainText('„Mobilfunk“ und 39,99 €');
	await expect(detail.getByTestId('tx-private-hint')).toContainText('nur die Treffer');
	await detail.getByTestId('tx-private-search').click();
	const hits = detail.getByTestId('tx-private-hit');
	await expect(hits).toHaveCount(1);
	await expect(hits.getByTestId('tx-private-criteria')).toContainText('passt: Anbieter + Betrag');
	await expect(hits).toContainText(`Rechnung-${RECEIPTS.mobilfunk.invoice}.pdf`);
	await hits.getByTestId('tx-private-import').click();
	await expect(detail.getByTestId('tx-private-result')).toHaveText(
		'Übernommen, ausgelesen und abgeglichen.'
	);
	await expect(detail.getByTestId('tx-linked-vendor')).toHaveText(NAMES.mobil);
	await expect(detail.getByTestId('tx-linked-state')).toContainText('automatisch');
	await expect(detail.getByTestId('tx-receipt-preview')).toHaveAttribute('data-rendered', 'true');
	expect(llm.requests.length).toBe(5);
	await page.screenshot({ path: test.info().outputPath('zahlung-detail.png') });
	// On a phone the panel fills the screen, without sideways scrolling.
	await page.setViewportSize({ width: 375, height: 812 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: test.info().outputPath('zahlung-detail-phone.png') });
	await page.setViewportSize({ width: 1280, height: 720 });
	await detail.getByTestId('tx-detail-close').click();
	await expect(page.getByTestId('filter-without-receipt')).toHaveText('Nur ohne Beleg (0)');
	await expect(monthButton.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
	// Only the hit came in: no other private mail is anywhere on the page.
	await tab('Belege').click();
	await expect(receipts).toHaveCount(7);
	const content = await page.content();
	for (const privateText of ['Privatgeheimnis', 'Planung.pdf', 'Energie-News', 'Junkordner']) {
		expect(content.includes(privateText), privateText).toBe(false);
	}

	// The receipt knows its booking, and opens it.
	await wolke.click();
	const receiptDetail = page.getByTestId('receipt-detail');
	await expect(receiptDetail.getByTestId('receipt-linked-tx')).toContainText(NAMES.wolke);
	await expect(receiptDetail.getByTestId('receipt-linked-tx')).toContainText('-119,00');
	await receiptDetail.getByTestId('receipt-open-tx').click();
	await expect(page.getByTestId('tx-detail-counterparty')).toHaveText(NAMES.wolke);
	await page.getByTestId('tx-detail-close').click();

	// Home: one question left (the unverified sender); a new run changes nothing.
	await tab('Home').click();
	await expect(page.getByTestId('agent-open')).toHaveText('1 offene Rückfrage');
	await expect(page.getByTestId('agent-progress')).toHaveText('3 von 4 erledigt');
	await expect(page.getByTestId('coverage-percent')).toHaveText('100 %');
	await page.screenshot({ path: test.info().outputPath('home.png'), fullPage: true });
	await page.getByTestId('match-run').click();
	await expect(page.getByTestId('match-result')).toHaveText(
		'0 zugeordnet · 1 Rückfrage · 3 ohne Beleg-Pflicht'
	);
	await expect(page.getByTestId('agent-progress')).toHaveText('3 von 4 erledigt');

	// Verlauf: the reads, the runs, the decisions, each with its links.
	await page.getByTestId('home-verlauf').click();
	const events = page.getByTestId('verlauf-event');
	await expect(events.first()).toHaveAttribute('data-kind', 'matching');
	await expect(events.first().getByTestId('verlauf-title')).toHaveText(
		'Abgleich (von dir gestartet)'
	);
	await page.locator('[data-testid="verlauf-filter"][data-group="auslesen"]').click();
	await expect(events).toHaveCount(5);
	await expect(events.filter({ hasText: NAMES.wolke }).getByTestId('verlauf-text')).toContainText(
		'deepseek-flash'
	);
	await page.locator('[data-testid="verlauf-filter"][data-group="abgleich"]').click();
	const auto = events.filter({ hasText: `Zugeordnet: ${NAMES.wolke}` });
	await expect(auto).toHaveCount(1);
	await page.locator('[data-testid="verlauf-filter"][data-group="entscheidungen"]').click();
	await expect(events.filter({ hasText: 'Zuordnung gelöst' })).toHaveCount(1);
	await expect(events.filter({ hasText: 'Rückfrage beantwortet: kein Beleg nötig' })).toHaveCount(
		1
	);
	await page.locator('[data-testid="verlauf-filter"][data-group="abruf"]').click();
	await expect(events.filter({ hasText: 'Umsätze abgerufen' })).toHaveCount(1);
	await expect(events.filter({ hasText: 'E-Mails abgerufen' })).toHaveCount(1);
	await page.screenshot({ path: test.info().outputPath('verlauf.png'), fullPage: true });
	// A link leads to the booking.
	await page.locator('[data-testid="verlauf-filter"][data-group="abgleich"]').click();
	await auto.getByTestId('verlauf-open-tx').click();
	await expect(page.getByTestId('tx-detail-counterparty')).toHaveText(NAMES.wolke);
	await page.getByTestId('tx-detail-close').click();
	await tab('Home').click();
	await expect(page.getByTestId('agent-card')).toBeVisible();

	// After a reload, the decisions are still there.
	await page.reload();
	await page.getByRole('button', { name: 'Mit gespeichertem Passkey entsperren' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await expect(page.getByTestId('coverage-percent')).toHaveText('100 %');
	await expect(page.getByTestId('agent-progress')).toHaveText('3 von 4 erledigt');

	// At rest: matches, questions, rules and reasons are sealed like everything else.
	const { inventory, text } = await everythingStoredAsText(page);
	expect(inventory.reduce((sum, db) => sum + db.records, 0)).toBeGreaterThan(0);
	for (const secret of [
		...Object.values(NAMES),
		RECEIPTS.wolkenfabrik.invoice,
		RECEIPTS.mobilfunk.invoice,
		RECEIPTS.mobilfunk.marker,
		RECEIPTS.stromwerk.vendor,
		NO_RECEIPT_REASON,
		'Bescheid liegt vor',
		'Finanzamt',
		'invoice-number',
		'unsure-match',
		'missing-receipt',
		'mail-fetch',
		'bank-sync',
		'deepseek-flash',
		'no-receipt'
	]) {
		expect(text.includes(secret), `${secret} readable at rest`).toBe(false);
	}
});
