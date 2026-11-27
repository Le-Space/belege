// Work goes on through a cloud outage (#961): the three devices of
// device-own-passkey.spec.js – a laptop, a phone and an office laptop, each
// with a passkey of its own, joined by QR – work on the same books, and no
// browser sends a request beyond this machine. The laptop holds the bridge,
// with the model behind it (here the fake LLM, on this machine), and serves it
// to the own devices; the other two cannot reach 127.0.0.1, as a phone cannot.
//
// - On the phone, "✦ Konto vorschlagen" asks the model through the laptop;
//   "Einsetzen" and "Übernehmen" book the account. On the laptop the payment
//   shows it, and leaves "Ohne Konto".
// - On the office laptop, a receipt that no payment had is assigned to a
//   payment without one; the laptop shows the match.
//
// The steps of the film; sample data only ("Beispieldaten", and one made-up
// payment).
import { test, expect } from '@playwright/test';

import { defaultConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { acceptConsent } from './consent.js';
import { openDevicesAdvanced, openIntegration } from './integrations.js';
import { startBridge } from './bridge-process.js';
import { joinOwn, ownDevice, recordOutside } from './devices.js';

const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);

/** @type {Awaited<ReturnType<typeof startFakeLlm>>} */ let llm;
/** @type {import('./bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	llm = await startFakeLlm();
	llm.answers.respond = (body) =>
		String(body.messages?.[0]?.content ?? '').includes('contra account (Gegenkonto)')
			? { picks: [{ account: '4964', confidence: 'high', reason: 'Monatliches Hosting.' }] }
			: undefined;
	bridge = await startBridge({
		name: 'device-outage',
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

/** @param {import('@playwright/test').Page} page @param {string} name */
const tab = (page, name) => page.getByRole('link', { name, exact: true }).click();

/**
 * Another device than the laptop: the laptop's 127.0.0.1 – its bridge and the
 * bridge's node – is out of reach.
 *
 * @param {Awaited<ReturnType<typeof ownDevice>>} d
 */
async function elsewhere(d) {
	/** @type {string[]} */
	const blocked = [];
	await d.context.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (route) => {
		blocked.push(new URL(route.request().url()).pathname);
		return route.abort('connectionrefused');
	});
	await d.context.routeWebSocket(
		(url) => url.hostname === '127.0.0.1',
		(ws) => ws.close()
	);
	return blocked;
}

/**
 * A payment's row in the Zahlungen list, found by the search: the list shows
 * one month at a time, and the sample's payments are in the month before.
 *
 * @param {import('@playwright/test').Page} page @param {string} name
 */
async function row(page, name) {
	await page.getByTestId('transaction-search').fill(name);
	return page.getByTestId('transaction').filter({ hasText: name }).first();
}

/** The count in "Ohne Konto (n)". @param {import('@playwright/test').Page} page */
async function withoutAccount(page) {
	const text = String(await page.getByTestId('filter-without-account').textContent());
	return Number(/\((\d+)\)/.exec(text)?.[1]);
}

test('through the outage: the phone books an account the laptop’s model suggests, the office laptop assigns a receipt', async ({
	browser
}) => {
	test.setTimeout(600_000);
	const laptop = await ownDevice(browser, 6);
	const phone = await ownDevice(browser, 7);
	const office = await ownDevice(browser, 8);
	// The laptop serves its bridge to the own devices (Erweitert → "Bridge teilen").
	await laptop.context.addInitScript(() => localStorage.setItem('belege.bridge-share', 'on'));
	const phoneBlocked = await elsewhere(phone);
	await elsewhere(office);
	const outside = recordOutside([laptop, phone, office], { localSockets: true });
	try {
		// The laptop: a passkey, the sample books, its bridge.
		await laptop.page.goto('/');
		await acceptConsent(laptop.page);
		await laptop.page.getByTestId('passkey-label').fill('E2E Laptop');
		await laptop.page.getByRole('button', { name: 'Passkey anlegen' }).click();
		await expect(laptop.page.getByTestId('own-did')).toBeVisible();
		await laptop.page.getByTestId('setup-start-ack').check();
		await laptop.page.getByTestId('setup-start-look').click();
		await expect(laptop.page.getByTestId('sample-banner')).toBeVisible({ timeout: 60_000 });
		// A payment that waits for its receipt: the sample's Stromwerk invoice, paid
		// later than it was issued (made up).
		await laptop.page.evaluate(() => {
			const day = new Date();
			day.setDate(day.getDate() - 2);
			return /** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: day.toISOString().slice(0, 10),
				counterparty: 'Stromwerk Test AG',
				purpose: 'Abschlag Strom Büro',
				amountCents: -4500,
				currency: 'EUR'
			});
		});
		await tab(laptop.page, 'Integrationen');
		await laptop.page.getByTestId('pairing-code').fill(bridge.code());
		await laptop.page.getByRole('button', { name: 'Koppeln', exact: true }).click();
		await expect(laptop.page.getByTestId('bridge-status')).toContainText(
			'dieses Gerät ist gekoppelt'
		);
		await openIntegration(laptop.page, 'geraete');
		await openDevicesAdvanced(laptop.page);
		await expect(laptop.page.getByTestId('devices-bridge-served')).toBeVisible({
			timeout: 30_000
		});

		// The phone and the office laptop join by QR, each with its own passkey.
		await joinOwn(laptop, phone, 'E2E Telefon');
		await expect(phone.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
		await joinOwn(laptop, office, 'E2E Büro-Laptop');
		await expect(office.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });

		// What the laptop sees before: the Wolkenfabrik payment without an account,
		// the Stromwerk payment without a receipt.
		await tab(laptop.page, 'Zahlungen');
		await laptop.page.getByTestId('filter-all').click();
		await expect(await row(laptop.page, 'Stromwerk Test AG')).toBeVisible({ timeout: 30_000 });
		await laptop.page.getByTestId('transaction-search').fill('');
		const before = await withoutAccount(laptop.page);
		expect(before).toBeGreaterThan(0);

		// The phone: its bridge runs through the laptop.
		await tab(phone.page, 'Integrationen');
		const status = phone.page.getByTestId('bridge-status');
		await expect(status).toHaveAttribute('data-paired', 'true', { timeout: 180_000 });
		await expect
			.poll(
				async () => {
					const state = await status.getAttribute('data-state');
					if (state === 'offline') await phone.page.getByTestId('bridge-check').click();
					return state;
				},
				{ timeout: 120_000, intervals: [2_000] }
			)
			.toBe('online');
		await expect(status).toContainText('über deinen Mac');

		// …and asks the laptop's model for the Wolkenfabrik payment's account.
		await tab(phone.page, 'Zahlungen');
		await phone.page.getByTestId('filter-without-account').click();
		await (await row(phone.page, 'Wolkenfabrik Hosting GmbH')).click();
		const booking = phone.page.getByTestId('tx-booking');
		await expect(booking).toHaveAttribute('data-confirmed', 'false');
		await booking.getByTestId('tx-booking-ai-ask').click();
		await expect(booking.getByTestId('tx-booking-ai-picks')).toContainText('4964', {
			timeout: 60_000
		});
		await booking.getByTestId('tx-booking-ai-take').click();
		await expect(booking.getByTestId('tx-booking-account')).toHaveValue('4964');
		await booking.getByTestId('tx-booking-confirm').click();
		await expect(booking).toHaveAttribute('data-confirmed', 'true');
		// It tried its own 127.0.0.1 first and was refused: the answer came through the laptop.
		expect(phoneBlocked).toContain('/booking/assist');

		// The laptop: the payment has its account, and left "Ohne Konto".
		await expect.poll(() => withoutAccount(laptop.page), { timeout: 90_000 }).toBe(before - 1);
		await (await row(laptop.page, 'Wolkenfabrik Hosting GmbH')).click();
		const there = laptop.page.getByTestId('tx-booking');
		await expect(there).toHaveAttribute('data-confirmed', 'true');
		await expect(there.getByTestId('tx-booking-account')).toHaveValue('4964');
		await laptop.page.getByTestId('tx-detail-close').click();

		// The office laptop assigns the Stromwerk receipt to the payment that had none.
		await tab(office.page, 'Zahlungen');
		await office.page.getByTestId('filter-all').click();
		await (await row(office.page, 'Stromwerk Test AG')).click({ timeout: 90_000 });
		const detail = office.page.getByTestId('tx-detail');
		await expect(detail.getByTestId('tx-detail-missing')).toBeVisible();
		await detail
			.getByTestId('tx-choice')
			.filter({ hasText: 'Stromwerk Test AG' })
			.first()
			.getByTestId('tx-choose')
			.click();
		await expect(detail.getByTestId('tx-linked-vendor')).toHaveText('Stromwerk Test AG');

		// The laptop shows the match.
		await (await row(laptop.page, 'Stromwerk Test AG')).click();
		await expect(laptop.page.getByTestId('tx-linked-vendor')).toHaveText('Stromwerk Test AG', {
			timeout: 90_000
		});

		// Nobody beyond this machine was asked: no Aleph, no relay, no STUN.
		expect(outside).toEqual([]);
	} finally {
		for (const d of [laptop, phone, office]) await d.context.close();
	}
});
