// A wallet payment's detail (issue #254): whose address is whose, each fact
// once, and "Wohin ging das Geld?" – the other side found quickly. Made-up
// Filecoin books: an own wallet, a send from it with its fee, an earlier send
// to the same address, and a Kraken deposit of nearly the same FIL that day.
// With REVIEW_DIR set, the detail is also photographed (light, dark, phone)
// for the UI review.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const OWN = 'f1ownwalletexampleaaaaaaaaaaaaaaaaaaaabbbb';
const OTHER = 'f410fotheraddressexamplexxxxxxxxxxxxxxxyyyy';
const CID = 'bafy2bzaceexamplemessagecidaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const EARLIER = 'bafy2bzaceexampleearliermessagebbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

/** @param {import('@playwright/test').Page} page @param {string} name */
async function shot(page, name) {
	const dir = process.env.REVIEW_DIR;
	if (!dir) return;
	await page.getByTestId('tx-detail').screenshot({ path: `${dir}/${name}.png` });
}

/** @param {import('@playwright/test').Page} page */
async function seed(page) {
	const today = new Date().toISOString().slice(0, 10);
	const earlier = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
	await page.evaluate(
		async ({ OWN, OTHER, CID, EARLIER, today, earlier }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const wallet = await e2e.addAccount({
				source: 'filecoin',
				sourceAccountId: `filecoin:${OWN}:FIL`,
				walletAddress: OWN,
				name: 'Filecoin · FIL',
				asset: 'FIL',
				currency: 'EUR'
			});
			const kraken = await e2e.addAccount({
				source: 'kraken',
				sourceAccountId: 'kraken:FIL',
				name: 'Kraken · FIL',
				asset: 'FIL',
				currency: 'EUR'
			});
			const send = {
				accountId: wallet.id,
				source: 'filecoin',
				bookedOn: today,
				bookedAt: `${today}T11:21:00.000Z`,
				amountCents: -8853,
				currency: 'EUR',
				asset: 'FIL',
				decimals: 18,
				counterparty: OTHER,
				counterpartyAddress: OTHER,
				bookingType: 'Gesendet',
				movement: 'transfer',
				valuation: { rate: '1.1138044488773364', source: 'coingecko', at: `${today}T00:00:00Z` }
			};
			await e2e.addTransaction({
				...send,
				sourceId: `${CID}:send:0`,
				quantity: '-79481450000000000000',
				purpose: `Gesendet · Tx ${CID.slice(0, 8)}…${CID.slice(-4)}`,
				txRef: CID,
				explorerUrl: `https://filfox.info/en/message/${CID}`
			});
			await e2e.addTransaction({
				...send,
				sourceId: `${CID}:fee`,
				amountCents: -1,
				quantity: '-5204232758331',
				counterparty: 'Netzwerkgebühr',
				counterpartyAddress: '',
				bookingType: 'Gebühr',
				movement: 'fee',
				purpose: `Gebühr · Tx ${CID.slice(0, 8)}…${CID.slice(-4)}`,
				txRef: CID,
				explorerUrl: `https://filfox.info/en/message/${CID}`
			});
			await e2e.addTransaction({
				...send,
				sourceId: `${EARLIER}:send:0`,
				bookedOn: earlier,
				bookedAt: `${earlier}T09:00:00.000Z`,
				amountCents: -1200,
				quantity: '-10000000000000000000',
				purpose: `Gesendet · Tx ${EARLIER.slice(0, 8)}…${EARLIER.slice(-4)}`,
				txRef: EARLIER,
				explorerUrl: `https://filfox.info/en/message/${EARLIER}`
			});
			// The exchange's deposit: no hash, a little less (its own fee), the same day.
			await e2e.addTransaction({
				accountId: kraken.id,
				source: 'kraken',
				bookedOn: today,
				bookedAt: `${today}T11:40:00.000Z`,
				amountCents: 8840,
				currency: 'EUR',
				asset: 'FIL',
				decimals: 18,
				quantity: '79381450000000000000',
				counterparty: 'Kraken',
				bookingType: 'deposit',
				purpose: 'deposit FIL',
				txRef: 'LEXAMPLE-DEPOSIT-0001'
			});
		},
		{ OWN, OTHER, CID, EARLIER, today, earlier }
	);
}

/** @param {import('@playwright/test').Page} page */
async function openSend(page) {
	await page.getByRole('navigation').getByRole('link', { name: 'Zahlungen' }).click();
	await page.getByTestId('transaction').filter({ hasText: '88,53' }).first().click();
	await expect(page.getByTestId('tx-detail')).toBeVisible();
}

test('a wallet send says whose address is whose, once each, and where the money went', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();
	await seed(page);
	await openSend(page);
	const detail = page.getByTestId('tx-detail');
	await detail
		.getByRole('button', { name: /Details/ })
		.first()
		.click();
	await shot(page, 'light');
	// The app's own theme switch: a `.dark` class on <html> (ThemeToggle.svelte).
	await page.evaluate(() => document.documentElement.classList.add('dark'));
	await shot(page, 'dark');
	await page.evaluate(() => document.documentElement.classList.remove('dark'));
	await page.setViewportSize({ width: 390, height: 900 });
	await shot(page, 'phone');
	await page.setViewportSize({ width: 1280, height: 900 });

	// Whose is whose: ours marked, the other an unknown address, each short; the
	// heading says which way, not a bare address.
	await expect(detail.getByTestId('tx-detail-counterparty')).toHaveText(/^An f410foth…/);
	await expect(detail.getByTestId('tx-party-from-own')).toHaveText('eigene Wallet');
	await expect(detail.getByTestId('tx-party-to')).toContainText('unbekannte Adresse');
	await expect(detail.getByTestId('tx-party-to-explorer')).toHaveAttribute(
		'href',
		`https://filfox.info/en/address/${OTHER}`
	);
	// Each fact once: no full address anywhere, the hash once, no repeated purpose.
	const text = await detail.innerText();
	expect(text).not.toContain(OTHER);
	expect(text).not.toContain(OWN);
	expect(text.split(CID).length - 1).toBe(1);
	expect(text).not.toContain('Tx bafy');
	await expect(detail.getByTestId('tx-detail-address')).toHaveCount(0);
	await expect(detail.getByTestId('tx-detail-purpose')).toHaveCount(0);
	await expect(detail.getByTestId('tx-detail-valuation')).toContainText('1,1138 EUR je FIL');
	await expect(detail.getByTestId('tx-status-konto')).toHaveAttribute('title', /Buchungskonto/);
	// A chain message, not an exchange's reference.
	await expect(detail.getByText('gleicher Tx-Hash')).toBeVisible();

	// Where it went: the earlier booking to the same address, and the Kraken deposit as a candidate.
	const where = detail.getByTestId('tx-where');
	await expect(where.getByTestId('tx-where-same')).toContainText('Eine weitere Buchung');
	await expect(where.getByTestId('tx-where-candidate')).toContainText('Kraken · FIL');

	// Naming the address names every booking with it.
	await where.getByTestId('tx-where-name').fill('Testlieferant Ahornweg');
	await where.getByTestId('tx-where-name-save').click();
	await expect(detail.getByTestId('tx-detail-counterparty')).toHaveText('Testlieferant Ahornweg');
	await where.getByTestId('tx-where-same-show').click();
	await detail.getByTestId('tx-other').first().click();
	await expect(detail.getByTestId('tx-detail-counterparty')).toHaveText('Testlieferant Ahornweg');
	await expect(detail.getByTestId('tx-detail-amount')).toContainText('12,00');

	// Back to the send: the deposit is the same transfer – one click, and it says so.
	await detail.getByTestId('tx-detail-close').click();
	await page.getByTestId('transaction').filter({ hasText: '88,53' }).first().click();
	await detail.getByTestId('tx-where-link').click();
	await expect(detail.getByTestId('tx-detail-counterparty')).toHaveText('Kraken · FIL');
	await expect(detail.getByTestId('tx-where')).toHaveCount(0);
	await expect(detail.getByTestId('tx-counter-open')).toBeVisible();
});
