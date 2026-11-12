// "Im Postfach suchen" on a trip's gap (#693 c), end to end: a trip by bus
// to Ortshausen and back with no lodging for its night; the question
// searches the whole mailbox of a fake mail server through the real bridge
// in test mode, finds the hostel's booking sent weeks before, takes it over
// on a click, assigns it to the trip and reads it with a fake model – and
// the night is asked no more. Towns, vendors and mails are made up.
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
	HOSTEL_BOOKING,
	sampleMailbox,
	startFakeImap
} from '@belege/bridge/testing/imap';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);
const APP_ORIGIN = `http://localhost:${process.env.E2E_PORT || 4391}`;
const CLI = fileURLToPath(new URL('../../bridge/src/cli.js', import.meta.url));

/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('node:child_process').ChildProcess} */ let bridge;
/** @type {string} */ let dir;
let bridgeOut = '';

test.beforeAll(async () => {
	imap = await startFakeImap({ storage: sampleMailbox({ hostelBooking: true }) });
	llm = await startFakeLlm();
	// The hostel's booking, as the model reads it: one night in Ortshausen.
	llm.answers.respond = () => ({
		document_type: 'invoice',
		vendor: HOSTEL_BOOKING.vendor,
		currency: 'EUR',
		net: null,
		vat: [],
		gross: 30,
		summary: 'Übernachtung',
		travel: {
			kind: 'hotel',
			place: HOSTEL_BOOKING.place,
			check_in: '2026-05-04',
			check_out: '2026-05-05',
			nights: 1
		}
	});
	dir = await mkdtemp(join(tmpdir(), 'belege-e2e-travel-mail-'));
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
				model: 'deepseek-flash',
				retryModel: 'deepseek-v4-pro',
				redaction: 'off',
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

test('a night without lodging: the mailbox searched, the booking taken over onto the trip, the night asked no more (#693 c)', async ({
	page
}) => {
	test.setTimeout(120_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Reise');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const code = /Pairing code[^:]*: (\S+)/.exec(bridgeOut)?.[1] ?? '';
	await tab('Integrationen').click();
	await pairBridge(page, { code, out: () => bridgeOut });

	// The bus there and back, read before; nothing for the night between.
	await page.evaluate(async () => {
		const hooks = /** @type {any} */ (window).__belegeE2E;
		/** @param {string} vendor @param {Record<string, any>} travel */
		const add = (vendor, travel) =>
			hooks.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				currency: 'EUR',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: 1900,
				documentDate: travel.departure.slice(0, 10),
				extraction: { document_type: 'ticket', gross: 19, vat: [], travel }
			});
		await add('Bus Hin Beispiel', {
			kind: 'bus',
			from: 'A-Stadt',
			to: 'Ortshausen',
			from_country: 'DE',
			to_country: 'AT',
			departure: '2026-05-04T08:00',
			arrival: '2026-05-04T13:00'
		});
		await add('Bus Zurück Beispiel', {
			kind: 'bus',
			from: 'Ortshausen',
			to: 'A-Stadt',
			from_country: 'AT',
			to_country: 'DE',
			departure: '2026-05-05T09:00',
			arrival: '2026-05-05T14:00'
		});
	});

	await tab('Belege').click();
	await page.getByTestId('belege-reisen').click();
	const picker = page.getByTestId('reisen-month');
	await picker.getByLabel('Monat: Jahr').selectOption('2026');
	await picker.getByLabel('Monat: Monat').selectOption('05');
	await page.getByTestId('reisen-proposal-accept').click();
	await expect(page.getByTestId('reise-receipt')).toHaveCount(2);

	const night = page.locator('[data-testid="reise-check"][data-kind="night"]');
	await expect(night).toContainText('Nacht vom 04.05.2026 ohne Unterkunft');
	await night.getByTestId('reise-check-mail').click();
	// What is searched, named: ± 30 days, the place and the words of a booking.
	await expect(night.getByTestId('reise-mail-hint')).toContainText(
		'vom 04.04.2026 bis 03.06.2026 nach Mails mit einem von: „Ortshausen“, „hotel“, „hostel“'
	);
	const hit = night.getByTestId('reise-mail-hit');
	await expect(hit).toHaveCount(1);
	await expect(hit).toContainText(`Ihre Buchung im ${HOSTEL_BOOKING.vendor}, Ortshausen`);
	await expect(hit.getByTestId('reise-mail-found')).toContainText('passt: „Ortshausen“ + „hostel“');
	await expect(hit.getByTestId('reise-mail-found')).toContainText('Anhang: Buchung.pdf');

	const asked = llm.requests.length;
	await hit.getByTestId('reise-mail-take').click();
	// Taken over, on this trip, read: the night has its lodging and is asked no more.
	await expect(page.getByTestId('reise-receipt')).toHaveCount(3, { timeout: 20_000 });
	await expect(
		page.getByTestId('reise-receipt').filter({ hasText: HOSTEL_BOOKING.vendor })
	).toHaveCount(1);
	await expect(night).toHaveCount(0, { timeout: 20_000 });
	expect(llm.requests.length).toBe(asked + 1);
});
