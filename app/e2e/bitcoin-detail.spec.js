// A Bitcoin payment's detail (issue #1037): the flow of inputs and outputs,
// the own receiving address, the payout-wallet assessment, an answer that
// holds for one booking only, and one next step instead of two chips.
// Made-up books: a receipt from an exchange's payout wallet (1 input → 8
// outputs, change back to the sender), a second payout from that address,
// an own send with change, and a transfer between two own wallets.
// With REVIEW_DIR set, the detail is photographed (dark, phone) for review.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const OURS = 'bc1qexampleownreceive0000000000000000k7m2';
const OUR_CHANGE = 'bc1qexampleownchange00000000000000000d6g';
const B_RECEIVE = 'bc1qexampleaccountb0000000000000000000f8j';
const SENDER = '3Ex4mpLePayoutWa11etXXXXXXXXXXXyz9';
const VENDOR = 'bc1qexamplevendor0000000000000000000000c5f';
const other = (/** @type {number} */ i) => `bc1qexampleother${i}aaaaaaaaaaaaaaaaaaaaaaaaa`;
const hash = (/** @type {string} */ c) => c.repeat(64);

/** @param {import('@playwright/test').Page} page @param {string} name */
async function shot(page, name) {
	const dir = process.env.REVIEW_DIR;
	if (!dir) return;
	await page.getByTestId('tx-detail').screenshot({ path: `${dir}/${name}.png` });
}

/** @param {import('@playwright/test').Page} page */
async function seed(page) {
	const today = new Date().toISOString().slice(0, 10);
	await page.evaluate(
		async ({ OURS, OUR_CHANGE, B_RECEIVE, SENDER, VENDOR, others, hashes, today }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const a = await e2e.addAccount({
				source: 'bitcoin',
				sourceAccountId: 'bitcoin:btc-0a1b2c3d:BTC',
				walletAddress: 'btc-0a1b2c3d',
				name: 'Konto A · BTC',
				asset: 'BTC',
				currency: 'EUR'
			});
			const b = await e2e.addAccount({
				source: 'bitcoin',
				sourceAccountId: 'bitcoin:btc-4e5f6a7b:BTC',
				walletAddress: 'btc-4e5f6a7b',
				name: 'Konto B · BTC',
				asset: 'BTC',
				currency: 'EUR'
			});
			await e2e.addAccount({
				source: 'kraken',
				sourceAccountId: 'kraken:BTC',
				name: 'Kraken · BTC',
				asset: 'BTC',
				currency: 'EUR'
			});
			const base = {
				source: 'bitcoin',
				bookedOn: today,
				bookedAt: `${today}T13:32:00.000Z`,
				currency: 'EUR',
				asset: 'BTC',
				decimals: 8,
				movement: 'transfer',
				valuation: { rate: '65812', source: 'coingecko', at: `${today}T00:00:00Z` }
			};
			/** @param {string} h @param {number} height @param {Record<string, any>} utxo */
			const tx = (h, height, utxo) => ({
				txRef: h,
				explorerUrl: `https://mempool.space/tx/${h}`,
				utxo: { fee: '4210', height, ...utxo }
			});
			const payout = (/** @type {string} */ h, /** @type {string} */ sats) => ({
				inputs: [{ address: SENDER, sats: '148210000', own: false, count: 1 }],
				outputs: [
					{ address: others[0], sats: '5000000', own: false },
					{ address: OURS, sats, own: true },
					{ address: SENDER, sats: '130871232', own: false },
					...others.slice(1, 6).map((/** @type {string} */ o) => ({
						address: o,
						sats: '2000000',
						own: false
					}))
				],
				inputCount: 1,
				outputCount: 8,
				senderTxs: 100000
			});
			// 1. The payout to us, and a later one from the same address.
			await e2e.addTransaction({
				...base,
				accountId: a.id,
				sourceId: `${hashes.payout}:value`,
				amountCents: 81240,
				quantity: '1234567',
				counterparty: SENDER,
				counterpartyAddress: SENDER,
				bookingType: 'Empfangen',
				purpose: 'Empfangen',
				...tx(hashes.payout, 871230, payout(hashes.payout, '1234567'))
			});
			await e2e.addTransaction({
				...base,
				accountId: a.id,
				sourceId: `${hashes.payout2}:value`,
				amountCents: 33300,
				quantity: '505000',
				counterparty: SENDER,
				counterpartyAddress: SENDER,
				bookingType: 'Empfangen',
				purpose: 'Empfangen',
				...tx(hashes.payout2, 871300, payout(hashes.payout2, '505000'))
			});
			// 2. An own payment with change.
			await e2e.addTransaction({
				...base,
				accountId: a.id,
				sourceId: `${hashes.send}:value`,
				amountCents: -27115,
				quantity: '-412000',
				counterparty: VENDOR,
				counterpartyAddress: VENDOR,
				bookingType: 'Gesendet',
				purpose: 'Gesendet',
				...tx(hashes.send, 871822, {
					inputs: [{ address: OURS, sats: '600000', own: true, count: 2 }],
					outputs: [
						{ address: VENDOR, sats: '412000', own: false },
						{ address: OUR_CHANGE, sats: '185200', own: true }
					],
					inputCount: 2,
					outputCount: 2,
					fee: '2800'
				})
			});
			// 3. From Konto A to Konto B: each wallet books its side of one transaction.
			const own = (/** @type {boolean} */ fromA) => ({
				inputs: [{ address: OURS, sats: '8000000', own: fromA, count: 1 }],
				outputs: [
					{ address: B_RECEIVE, sats: '5000000', own: !fromA },
					{ address: OUR_CHANGE, sats: '2996500', own: fromA }
				],
				inputCount: 1,
				outputCount: 2,
				fee: '3500'
			});
			await e2e.addTransaction({
				...base,
				accountId: a.id,
				sourceId: `${hashes.own}:value`,
				amountCents: -329060,
				quantity: '-5000000',
				counterparty: B_RECEIVE,
				counterpartyAddress: B_RECEIVE,
				bookingType: 'Gesendet',
				purpose: 'Gesendet',
				...tx(hashes.own, 870455, own(true))
			});
			await e2e.addTransaction({
				...base,
				accountId: b.id,
				sourceId: `${hashes.own}:value`,
				amountCents: 329060,
				quantity: '5000000',
				counterparty: OURS,
				counterpartyAddress: OURS,
				bookingType: 'Empfangen',
				purpose: 'Empfangen',
				...tx(hashes.own, 870455, own(false))
			});
		},
		{
			OURS,
			OUR_CHANGE,
			B_RECEIVE,
			SENDER,
			VENDOR,
			others: [1, 2, 3, 4, 5, 6].map(other),
			hashes: { payout: hash('a'), payout2: hash('b'), send: hash('c'), own: hash('d') },
			today
		}
	);
}

/** @param {import('@playwright/test').Page} page @param {string} amount */
async function open(page, amount) {
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	// An own transfer needs no receipt: "Nur ohne Beleg" would hide it.
	await page.getByTestId('filter-all').click();
	await page.getByTestId('transaction').filter({ hasText: amount }).first().click();
	await expect(page.getByTestId('tx-detail')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await seed(page);
	await page.evaluate(() => /** @type {any} */ (window).__belegeE2E.runMatching());
});

test('a payout wallet’s receipt: the flow, the assessment, an answer for this booking only', async ({
	page
}) => {
	await open(page, '812,40');
	const detail = page.getByTestId('tx-detail');

	// The head: which way, how much, one explorer link; the QR code in the ⋯ menu.
	await expect(detail.getByTestId('tx-head-direction')).toHaveText('Eingang');
	await expect(detail.getByTestId('tx-detail-quantity')).toHaveText(/^\+0,01234567\sBTC$/);
	await expect(detail.getByTestId('tx-explorer')).toHaveCount(1);
	await expect(detail.getByTestId('tx-explorer-qr-toggle')).toHaveCount(0);
	await detail.getByTestId('tx-head-menu').click();
	await detail.getByTestId('tx-explorer-qr-toggle').click();
	await expect(detail.getByTestId('tx-explorer-qr')).toBeVisible();
	// No chips any more: one next step.
	await expect(detail.getByTestId('tx-status')).toHaveCount(0);
	await expect(detail.getByTestId('tx-next-step')).toHaveAttribute('data-state', 'open');

	// The flow: 1 input → 8 outputs; ours with its real address, the change back to the sender.
	const flow = detail.getByTestId('tx-utxo');
	await expect(flow).toContainText('1 Eingang → 8 Ausgänge');
	const ours = flow.locator('[data-testid="tx-utxo-output"][data-role="ours"]');
	await expect(ours).toContainText('Konto A · BTC');
	await expect(ours.locator(`[title="${OURS}"]`)).toHaveCount(1);
	await expect(flow.locator('[data-testid="tx-utxo-output"][data-role="change"]')).toContainText(
		'zurück an den Absender'
	);
	await expect(flow.locator('[data-testid="tx-utxo-output"][data-role="other"]')).toHaveCount(0);
	await expect(flow.getByTestId('tx-utxo-more-open')).toContainText('6 weitere Empfänger');
	await expect(flow.getByTestId('tx-utxo-fee')).toContainText('bezahlt vom Absender');
	await flow.getByTestId('tx-utxo-more-open').click();
	await expect(flow.locator('[data-testid="tx-utxo-output"][data-role="other"]')).toHaveCount(6);

	// The sender looks like an exchange's payout wallet: said in one line, with why.
	const note = detail.getByTestId('tx-payout');
	await expect(note).toContainText('Sammelüberweisungen');
	for (const signal of ['busy', 'reused', 'batch', 'changeBack']) {
		await expect(note.locator(`[data-signal="${signal}"]`)).toHaveCount(1);
	}
	await shot(page, 'payout-light');
	await page.evaluate(() => document.documentElement.classList.add('dark'));
	await shot(page, 'payout-dark');
	await page.setViewportSize({ width: 390, height: 900 });
	await shot(page, 'payout-phone');
	// At phone width nothing runs off the side.
	expect(
		await detail.evaluate((el) => el.scrollWidth - el.clientWidth),
		'no sideways scroll'
	).toBeLessThanOrEqual(1);
	await page.evaluate(() => document.documentElement.classList.remove('dark'));
	await page.setViewportSize({ width: 1280, height: 900 });

	// The answer holds for this booking: own money at Kraken.
	const form = detail.getByTestId('tx-address-kind');
	await expect(form).toHaveAttribute('data-scope', 'booking');
	await expect(form.getByTestId('tx-address-kind-scope')).toContainText('nur für diese Buchung');
	await form.getByTestId('tx-address-kind-custodian').check();
	await expect(form.getByTestId('tx-address-kind-exchange')).toHaveValue(/.+/);
	await form.getByTestId('tx-where-name-save').click();
	await expect(detail.getByTestId('tx-address-kind-current')).toContainText('Für diese Buchung');
	// The next step books it as an own transfer from the exchange.
	const next = detail.getByTestId('tx-next-step');
	await expect(next).toContainText(/Als Umbuchung von Kraken · BTC buchen/);
	await next.getByTestId('tx-next-step-book').click();
	await expect(next).toHaveAttribute('data-state', 'done');

	// The next payout from that address is asked anew.
	await detail.getByTestId('tx-detail-close').click();
	await open(page, '333,00');
	await expect(detail.getByTestId('tx-address-kind')).toHaveAttribute('data-current', '');
	await expect(detail.getByTestId('tx-detail-counterparty')).not.toContainText('Kraken');
});

test('a name remembered for a payout wallet’s address is flagged for review', async ({ page }) => {
	await open(page, '333,00');
	const detail = page.getByTestId('tx-detail');
	// Remembered for the address before the assessment existed (made-up name).
	await page.evaluate(async (sender) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addPartner({
			name: 'Muster GmbH',
			aliases: [`addr:bitcoin:${sender}`],
			addressKinds: {},
			learnedFrom: 'address'
		});
		await e2e.runMatching();
	}, SENDER);
	await detail.getByTestId('tx-detail-close').click();
	await open(page, '333,00');
	const review = detail.getByTestId('tx-payout-review');
	await expect(review).toContainText('Muster GmbH');
	await review.getByTestId('tx-payout-review-keep').click();
	await expect(detail.getByTestId('tx-payout-review')).toHaveCount(0);
	await expect(detail.getByTestId('tx-address-kind-current')).toContainText('Für diese Buchung');
	// The other payout is no one's now.
	await detail.getByTestId('tx-detail-close').click();
	await open(page, '812,40');
	await expect(detail.getByTestId('tx-address-kind')).toHaveAttribute('data-current', '');
});

test('an own send with change, and a transfer between two own wallets', async ({ page }) => {
	await open(page, '271,15');
	const detail = page.getByTestId('tx-detail');
	await expect(detail.getByTestId('tx-head-direction')).toHaveText('Ausgang');
	const flow = detail.getByTestId('tx-utxo');
	await expect(flow).toContainText('2 Eingänge → 2 Ausgänge');
	await expect(flow.locator('[data-testid="tx-utxo-input"][data-role="ours"]')).toContainText(
		'aus 2 Eingängen'
	);
	await expect(flow.locator('[data-role="ourChange"]')).toContainText('Wechselgeld');
	await expect(flow.locator('[data-testid="tx-utxo-output"][data-role="other"]')).toContainText(
		'Empfänger'
	);
	await expect(flow.getByTestId('tx-utxo-fee')).toContainText('von dir bezahlt');
	// An ordinary address: the answer is for the address, as before.
	await expect(detail.getByTestId('tx-payout')).toHaveCount(0);
	await expect(detail.getByTestId('tx-address-kind')).toHaveAttribute('data-scope', 'address');
	await detail.getByTestId('tx-details-toggle').click();
	await expect(detail.getByTestId('tx-detail-block-time')).toContainText(/\d{2}:\d{2}/);
	await expect(detail.getByTestId('tx-detail-fee')).toContainText('0,000028');
	await expect(detail.getByTestId('tx-detail-ref-copy')).toContainText('c'.repeat(64));

	// Konto A → Konto B: an own transfer, one step to book it.
	await detail.getByTestId('tx-detail-close').click();
	await open(page, '3.290,60');
	await expect(detail.getByTestId('tx-head-direction')).toHaveText('Umbuchung');
	await expect(detail.getByTestId('tx-payout')).toHaveCount(0);
	const next = detail.getByTestId('tx-next-step');
	// Either side of the pair may come first: each names the other wallet.
	await expect(next).toContainText(/Umbuchung (von|an) Konto [AB] · BTC/);
	await next.getByTestId('tx-next-step-book').click();
	await expect(next).toHaveAttribute('data-state', 'done');
	await shot(page, 'own-transfer');
});
