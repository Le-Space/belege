// "✦ Konto vorschlagen" (POST /booking/assist): the real bridge in test mode,
// the fake LLM and the app. A chart is read in, the model is asked for the
// account of a payment, names one from the chart with a reason, and "Einsetzen"
// puts it in the field – nothing is taken by itself. The model is not on this
// machine as far as the bridge knows, so the IBAN in the purpose is blacked
// out in what was sent. All data made up.
import { test, expect } from '@playwright/test';
import { openSettings } from './settings.js';

import { defaultConfig } from '@belege/bridge';
import { FAKE_PASSWORD, sampleData, startFakeHibiscus } from '@belege/bridge/testing';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { pairBridge } from './bridge.js';
import { startBridge } from './bridge-process.js';

const IBAN = 'DE00 1234 5678 9012 3456 78';

/** @type {Awaited<ReturnType<typeof startFakeHibiscus>>} */ let hibiscus;
/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	hibiscus = await startFakeHibiscus({ data: sampleData() });
	llm = await startFakeLlm();
	llm.answers.respond = (body) =>
		String(body.messages?.[0]?.content ?? '').includes('contra account (Gegenkonto)')
			? {
					picks: [{ account: '4964', confidence: 'high', reason: 'Monatliches Software-Abo.' }]
				}
			: undefined;
	bridge = await startBridge({
		name: 'booking-ai',
		config: {
			hibiscus: {
				host: hibiscus.host,
				port: hibiscus.port,
				certSha256: hibiscus.fingerprint,
				ibanSuffixes: ['4711']
			},
			llm: {
				...defaultConfig().llm,
				model: 'deepseek-flash',
				retryModel: 'deepseek-v4-pro',
				baseUrl: llm.url,
				configured: true
			}
		},
		env: { BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD, BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY }
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await llm?.close();
	await hibiscus?.close();
});

test('the model suggests an account from the chart; the person puts it in', async ({ page }) => {
	test.setTimeout(120_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Konto-KI');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab('Integrationen').click();
	await pairBridge(page, bridge);

	await openSettings(page, 'kontenplan');
	const chart = page.getByTestId('chart');
	await chart.getByTestId('chart-file').setInputFiles({
		name: 'kontenplan.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'Konto;Bezeichnung\n1200;Bank Konto A\n4930;Bürobedarf\n4964;Software-Abos\n'
		)
	});
	await chart.getByTestId('chart-take').click();
	await expect(chart.getByTestId('chart-current')).toContainText('3 Konten');

	await page.evaluate(
		(iban) =>
			/** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: '2026-10-13',
				counterparty: 'Wolkenfabrik Hosting GmbH',
				purpose: `Abo Oktober ${iban}`,
				amountCents: -1234
			}),
		IBAN
	);
	await tab('Zahlungen').click();
	await page.getByText('Wolkenfabrik Hosting GmbH').first().click();
	const booking = page.getByTestId('tx-booking');
	await expect(booking.getByTestId('tx-booking-suggestion')).toContainText('Kein Vorschlag');

	// The info icon beside ✦ (#566): an estimate before the first call, from the
	// code's figures, priced as the bridge's model; hover, focus and a tap open it,
	// Escape closes it.
	const info = booking.getByTestId('tx-booking-ai-ask-cost');
	const tip = booking.getByTestId('tx-booking-ai-ask-cost-tip');
	await expect(tip).toBeHidden();
	await info.hover();
	await expect(tip).toBeVisible();
	await expect(tip).toContainText('Geschätzt für einen Aufruf');
	await expect(tip).toContainText('≈ 1.800 Tokens hinein, 600 heraus');
	await expect(tip).toContainText('bei deepseek-flash');
	await expect(tip).toContainText('Noch nichts gemessen');
	await expect(tip).toContainText('Nur eine Schätzung');
	await expect(info).toHaveAttribute('aria-describedby', /^ai-cost-/);
	expect(await tip.getAttribute('id')).toBe(await info.getAttribute('aria-describedby'));
	await page.mouse.move(0, 0);
	await expect(tip).toBeHidden();
	await info.focus();
	await expect(tip).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(tip).toBeHidden();
	await info.click();
	await page.mouse.move(0, 0);
	await expect(tip).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(tip).toBeHidden();

	await booking.getByTestId('tx-booking-ai-ask').click();
	const picks = booking.getByTestId('tx-booking-ai-picks');
	await expect(picks).toContainText('4964 Software-Abos');
	await expect(picks).toContainText('sicher – Monatliches Software-Abo.');
	// Nothing taken by itself.
	await expect(booking).toHaveAttribute('data-confirmed', 'false');
	await expect(booking.getByTestId('tx-booking-account')).toHaveValue('');

	await booking.getByTestId('tx-booking-ai-take').click();
	await expect(booking.getByTestId('tx-booking-account')).toHaveValue('4964');
	await expect(booking.getByTestId('tx-booking-account-name')).toHaveText('Software-Abos');

	// After the call, the estimate goes by what the Verlauf measured.
	await info.click();
	await expect(tip).toContainText('Nach dem letzten Aufruf im Verlauf.');
	await page.keyboard.press('Escape');

	const sent = booking.getByTestId('tx-booking-ai-sent');
	await sent.locator('summary').click();
	await expect(sent).toContainText('4964: Software-Abos');
	await expect(sent).toContainText('Wolkenfabrik Hosting GmbH');
	await expect(sent).not.toContainText(IBAN);
});

test('"Ohne Konto": the model suggests an account for every listed payment, each is taken in its row', async ({
	page
}) => {
	test.setTimeout(120_000);
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Konto-KI Liste');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await tab('Integrationen').click();
	await pairBridge(page, { code: pairingCode, out: () => bridgeOut });

	await openSettings(page, 'kontenplan');
	const chart = page.getByTestId('chart');
	await chart.getByTestId('chart-file').setInputFiles({
		name: 'kontenplan.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'Konto;Bezeichnung\n1200;Bank Konto A\n4930;Bürobedarf\n4964;Software-Abos\n'
		)
	});
	await chart.getByTestId('chart-take').click();
	await expect(chart.getByTestId('chart-current')).toContainText('3 Konten');

	for (const [counterparty, amountCents] of /** @type {const} */ ([
		['Wolkenfabrik Hosting GmbH', -1234],
		['Stromwerk Test AG', -2000]
	])) {
		await page.evaluate(
			(booking) => /** @type {any} */ (window).__belegeE2E.addTransaction(booking),
			{ bookedOn: '2026-10-13', counterparty, purpose: 'Abo Oktober', amountCents }
		);
	}
	await tab('Zahlungen').click();
	const filter = page.getByTestId('filter-without-account');
	await expect(filter).toContainText('(2)');
	// Only this filter has the fields: the other lists stay as they were.
	await expect(page.getByTestId('account-suggest')).toHaveCount(0);
	await filter.click();
	const rows = page.getByTestId('account-suggest');
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(0).getByTestId('account-suggest-input')).toHaveValue('');
	await expect(rows.nth(0).getByTestId('account-suggest-take')).toBeDisabled();

	const ask = page.getByTestId('suggest-accounts-ask');
	await expect(ask).toContainText('Konten vorschlagen (2)');
	const asked = llm.requests.length;
	await ask.click();
	for (const row of [rows.nth(0), rows.nth(1)]) {
		await expect(row.getByTestId('account-suggest-input')).toHaveValue('4964');
		await expect(row).toHaveAttribute('data-from', 'ai');
		await expect(row.getByTestId('account-suggest-why')).toContainText('Software-Abos');
		await expect(row.getByTestId('account-suggest-why')).toContainText(
			'sicher – Monatliches Software-Abo.'
		);
	}
	// One call a payment, and nothing taken by itself.
	expect(llm.requests.length - asked).toBe(2);
	await expect(filter).toContainText('(2)');
	await expect(page.getByTestId('suggest-accounts-nothing')).toBeVisible();
	await expect(ask).toBeDisabled();

	// "Übernehmen" in the row books this payment and no other.
	const hosting = page
		.locator('li', { hasText: 'Wolkenfabrik Hosting GmbH' })
		.getByTestId('account-suggest');
	await hosting.getByTestId('account-suggest-take').click();
	await expect(filter).toContainText('(1)');
	await expect(rows).toHaveCount(1);
	await expect(page.getByTestId('transaction')).toHaveCount(1);
	await expect(page.getByTestId('payee')).toHaveText('Stromwerk Test AG');

	// The other one with a number of the person's own: the field is theirs.
	await rows.getByTestId('account-suggest-input').fill('4930');
	await expect(rows.getByTestId('account-suggest-why')).toContainText('Bürobedarf');
	await expect(rows.getByTestId('account-suggest-why')).not.toContainText('Software-Abo');
	await rows.getByTestId('account-suggest-take').click();
	await expect(filter).toContainText('(0)');

	// What was taken is the payment's account, as if taken on its own page.
	await page.getByTestId('filter-all').click();
	await page.getByText('Stromwerk Test AG').first().click();
	const booking = page.getByTestId('tx-booking');
	await expect(booking).toHaveAttribute('data-confirmed', 'true');
	await expect(booking.getByTestId('tx-booking-account')).toHaveValue('4930');
});
