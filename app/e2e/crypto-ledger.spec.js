// Crypto movements in the open crypto-ledger format (issue #267), end to end:
// made-up wallet and exchange bookings in the books, "Kryptobewegungen" on the
// export page downloads them as JSON and as CSV, and the JSON passes the
// schema in schema/ – the file the browser wrote, not one built in the test.
// Every address, hash and amount is made up.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

const SCHEMA = new URL('../../schema/crypto-ledger.v1.schema.json', import.meta.url);
const EVM = '0x1111111111111111111111111111111111111111';
const HASH = `0x${'b'.repeat(64)}`;

test('the crypto bookings download as a crypto-ledger file the schema accepts', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(
		async ({ EVM, HASH }) => {
			const e2e = /** @type {any} */ (window).__belegeE2E;
			const wallet = await e2e.addAccount({
				source: 'base',
				sourceAccountId: `${EVM}:ETH`,
				ibanLast4: '',
				name: `Wallet ETH (Base) ···${EVM.slice(-6)}`,
				currency: 'EUR',
				kind: 'wallet',
				asset: 'ETH',
				decimals: 18,
				walletAddress: EVM
			});
			const kraken = await e2e.addAccount({
				source: 'kraken',
				sourceAccountId: 'BTC',
				ibanLast4: '',
				name: 'Kraken BTC',
				currency: 'EUR',
				kind: 'exchange',
				asset: 'BTC',
				decimals: 10
			});
			const valuation = (/** @type {string} */ rate, /** @type {string} */ day) => ({
				rate,
				currency: 'EUR',
				source: 'coingecko',
				at: `${day}T00:00:00Z`
			});
			const common = { currency: 'EUR', counterpartyIban: '', endToEndId: '', bankCode: '' };
			for (const tx of [
				{
					accountId: wallet.id,
					source: 'base',
					sourceId: `${HASH}:value`,
					bookedOn: '2025-05-03',
					bookedAt: '2025-05-03T09:30:00Z',
					amountCents: -8000,
					counterparty: '0x2222222222222222222222222222222222222222',
					counterpartyAddress: '0x2222222222222222222222222222222222222222',
					purpose: 'Überweisung · Tx 0xbbbb…bbbb',
					bookingType: 'Überweisung',
					movement: 'transfer',
					txRef: HASH,
					asset: 'ETH',
					quantity: '-50000000000000000',
					decimals: 18,
					valuation: valuation('1600', '2025-05-03'),
					rateMissing: null
				},
				{
					accountId: wallet.id,
					source: 'base',
					sourceId: `${HASH}:fee`,
					bookedOn: '2025-05-03',
					bookedAt: '2025-05-03T09:30:00Z',
					amountCents: -3,
					counterparty: 'Netzwerkgebühr',
					purpose: 'Netzwerkgebühr · Tx 0xbbbb…bbbb',
					bookingType: 'Netzwerkgebühr',
					movement: 'fee',
					txRef: HASH,
					asset: 'ETH',
					quantity: '-21000000000000',
					decimals: 18,
					valuation: valuation('1600', '2025-05-03'),
					rateMissing: null
				},
				{
					accountId: kraken.id,
					source: 'kraken',
					sourceId: 'LEXAMP-DDDDD-DDDDDD',
					bookedOn: '2024-01-20',
					bookedAt: '2024-01-20T09:00:00Z',
					amountCents: -48000,
					counterparty: 'Kraken',
					purpose: 'Auszahlung · Ref. FEXAMP-EEEEE-EEEEEE',
					bookingType: 'Auszahlung',
					movement: 'transfer',
					txRef: 'FEXAMP-EEEEE-EEEEEE',
					exchangeType: 'withdrawal',
					asset: 'BTC',
					quantity: '-60000000',
					decimals: 10,
					valuation: valuation('80000', '2024-01-20'),
					rateMissing: null
				}
			]) {
				await e2e.addTransaction({ ...common, ...tx });
			}
			await e2e.runMatching();
		},
		{ EVM, HASH }
	);

	await page.getByRole('navigation').getByRole('link', { name: 'Export' }).click();
	const section = page.getByTestId('export-crypto');
	await expect(section.getByTestId('export-crypto-year').locator('option')).toHaveText([
		'alle Jahre',
		'2025',
		'2024'
	]);

	const [json] = await Promise.all([
		page.waitForEvent('download'),
		section.getByTestId('export-crypto-json').click()
	]);
	expect(json.suggestedFilename()).toMatch(/^crypto-ledger-all-\d{4}-\d{2}-\d{2}\.json$/);
	await expect(section.getByTestId('export-crypto-done')).toContainText(
		'3 Bewegungen auf 2 Konten'
	);
	const ledger = JSON.parse(await readFile(/** @type {string} */ (await json.path()), 'utf8'));
	const ajv = new Ajv2020({ allErrors: true, strict: true });
	addFormats(ajv);
	const validate = ajv.compile(JSON.parse(await readFile(SCHEMA, 'utf8')));
	expect(validate(ledger) ? [] : validate.errors).toEqual([]);
	expect(ledger.accounts.map((/** @type {any} */ a) => a.id)).toEqual([
		`eip155:8453:${EVM}`,
		'kraken'
	]);
	expect(ledger.movements.map((/** @type {any} */ m) => [m.kind, m.amount])).toEqual([
		['transfer', '-0.006'],
		['fee', '-0.000021'],
		['transfer', '-0.05']
	]);

	// One year, as CSV.
	await section.getByTestId('export-crypto-year').selectOption('2025');
	const [csv] = await Promise.all([
		page.waitForEvent('download'),
		section.getByTestId('export-crypto-csv').click()
	]);
	expect(csv.suggestedFilename()).toMatch(/^crypto-ledger-2025-.*\.csv$/);
	const lines = (await readFile(/** @type {string} */ (await csv.path()), 'utf8')).split('\r\n');
	expect(lines[0].startsWith('date,time,account,account_name,kind,asset')).toBe(true);
	expect(lines.filter(Boolean)).toHaveLength(3);
});
