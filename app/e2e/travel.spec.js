// Travel (#213, step 3), end to end: a ticket asks for its trip; a new trip
// gets its times, a breakfast provided and a drive in a family member's car;
// the ticket is assigned to it as paid privately, a restaurant bill gets its
// hospitality details; the trip and the month add it all up. Every vendor,
// place, person and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('a trip with its allowance, mileage, a ticket paid privately, and a hospitality bill', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// Reisen in March 2025, reached from Belege (a reload would lock the books).
	const toMarch = async () => {
		await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
		await page.getByTestId('belege-reisen').click();
		const picker = page.getByTestId('reisen-month');
		await picker.getByLabel('Monat: Jahr').selectOption('2025');
		await picker.getByLabel('Monat: Monat').selectOption('03');
	};

	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const common = { source: 'upload', status: 'ausgelesen', currency: 'EUR' };
		await e2e.addReceipt({
			...common,
			fileName: 'bahn.pdf',
			vendor: 'Bahn Beispiel AG',
			amountCents: 8_990,
			documentDate: '2025-03-04',
			extraction: { document_type: 'ticket', gross: 89.9, vat: [{ rate: 7, amount: 5.88 }] }
		});
		await e2e.addReceipt({
			...common,
			fileName: 'gasthaus.pdf',
			vendor: 'Gasthaus Beispiel',
			amountCents: 11_900,
			documentDate: '2025-03-04',
			extraction: { document_type: 'receipt', gross: 119, vat: [{ rate: 19, amount: 19 }] }
		});
	});

	// Home leads to Reisen; the ticket waits for a trip.
	await expect(page.getByTestId('home-reisen')).toBeVisible();
	await toMarch();
	await expect(page.getByTestId('reisen-adviser')).toBeVisible();
	await expect(
		page.getByTestId('reisen-question').filter({ hasText: 'Ticket ohne Reise' })
	).toContainText('Bahn Beispiel AG');
	await expect(page.getByTestId('reisen-none')).toBeVisible();

	// A new trip, filled in on its page.
	await page.getByTestId('reisen-new').click();
	await expect(page.getByTestId('reise-form')).toBeVisible();
	await page.getByTestId('reise-destination').fill('Musterstadt');
	await page.getByTestId('reise-reason').fill('Workshop Kundin Beispiel UG');
	await page.getByTestId('reise-start').fill('2025-03-04T07:00');
	await page.getByTestId('reise-end').fill('2025-03-05T19:30');
	await page.getByTestId('reise-place').fill('Kundin Beispiel UG');
	await page.getByTestId('reise-meal-2025-03-05-breakfast').check();
	await page.getByTestId('reise-add-line').click();
	const line = page.getByTestId('reise-line');
	await line.getByTestId('reise-line-km').fill('120');
	await line.getByTestId('reise-line-vehicle').selectOption('family');
	await line.getByTestId('reise-line-owner').fill('Ehepartner');
	await line.getByRole('textbox', { name: 'Anlass' }).fill('Workshop');
	await page.getByTestId('reise-save').click();
	await expect(page.getByTestId('reise-saved')).toBeVisible();
	await expect(page.getByTestId('reise-problems')).toHaveCount(0);

	// 14 EUR and 14 EUR, less 20 % of 28 EUR for the breakfast; 240 km at 0,30 EUR.
	await expect(page.getByTestId('reise-allowance-day')).toHaveCount(2);
	await expect(page.getByTestId('reise-sum-allowance')).toHaveText('22,40 EUR');
	await expect(page.getByTestId('reise-line-result')).toContainText(
		'240 km × 0,30 EUR = 72,00 EUR'
	);
	await expect(page.getByTestId('reise-line-family-flag')).toContainText('Fremdes Fahrzeug');
	await expect(page.getByTestId('reise-sum-mileage')).toHaveText('72,00 EUR');

	// The ticket to the trip, paid privately.
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const receipt = (/** @type {string} */ name) =>
		page.getByTestId('receipt').filter({ hasText: name });
	const detail = page.getByTestId('receipt-detail');
	await receipt('Bahn Beispiel AG').click();
	await expect(detail.getByTestId('travel-looks-like')).toBeVisible();
	await detail.getByTestId('travel-open').click();
	await expect(detail.getByTestId('travel-trip')).toHaveValue(/.+/);
	await expect(detail.getByTestId('travel-form-paid-by')).toHaveValue('private');
	await detail.getByTestId('travel-assign').click();
	await expect(detail.getByTestId('travel-assigned')).toContainText('Musterstadt');

	// The restaurant bill as hospitality: 100 EUR net, 70 % of it deductible.
	await receipt('Gasthaus Beispiel').click();
	await detail.getByTestId('hospitality-open').click();
	await detail.getByTestId('hospitality-place').fill('Gasthaus Beispiel, Musterstadt');
	await detail.getByTestId('hospitality-participants').fill('Inhaberin Beispiel\nKunde Beispiel');
	await detail.getByTestId('hospitality-occasion').fill('Angebot Projekt Nord');
	await detail.getByTestId('hospitality-save').click();
	await expect(detail.getByTestId('hospitality-split')).toHaveText(
		'Abziehbar 70,00 EUR, nicht abziehbar 30,00 EUR, Vorsteuer 19,00 EUR.'
	);
	await expect(detail.getByTestId('hospitality-missing')).toHaveCount(0);

	// The trip with its receipt: allowance, mileage and the ticket to pay back.
	await receipt('Bahn Beispiel AG').click();
	await detail.getByTestId('travel-trip-link').click();
	await expect(page.getByTestId('reise-receipt')).toHaveCount(1);
	await expect(page.getByTestId('reise-sum-private')).toHaveText('89,90 EUR');
	await expect(page.getByTestId('reise-sum-back')).toHaveText('184,30 EUR');

	// The month: the trip, the hospitality bill, and nothing left to ask.
	await toMarch();
	await expect(page.getByTestId('reisen-trip')).toHaveCount(1);
	await expect(page.getByTestId('reisen-trip-sum')).toHaveText('94,40 EUR');
	await expect(page.getByTestId('reisen-hospitality-item')).toContainText('abziehbar 70,00 EUR');
	await expect(page.getByTestId('reisen-total-hospitality')).toHaveText('70,00 EUR');
	await expect(page.getByTestId('reisen-questions')).toHaveCount(0);
});

test('a trip from what a ticket and a hotel invoice were read as, the breakfast proposed', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		const common = { source: 'upload', status: 'ausgelesen', currency: 'EUR' };
		await e2e.addReceipt({
			...common,
			fileName: 'ticket.pdf',
			vendor: 'Bahn Beispiel AG',
			amountCents: 12_980,
			documentDate: '2025-04-01',
			extraction: {
				document_type: 'ticket',
				gross: 129.8,
				vat: [{ rate: 7, amount: 8.49 }],
				travel: {
					kind: 'train',
					from: 'Beispielstadt Hbf',
					to: 'Musterstadt Hbf',
					departure: '2025-04-08T07:12',
					arrival: '2025-04-08T10:48',
					return_departure: '2025-04-09T17:10',
					return_arrival: '2025-04-09T20:41'
				}
			}
		});
		await e2e.addReceipt({
			...common,
			fileName: 'hotel.pdf',
			vendor: 'Hotel Beispiel',
			amountCents: 11_200,
			documentDate: '2025-04-09',
			extraction: {
				document_type: 'invoice',
				gross: 112,
				vat: [{ rate: 7, amount: 7.33 }],
				travel: {
					kind: 'hotel',
					place: 'Musterstadt',
					check_in: '2025-04-08',
					check_out: '2025-04-09',
					nights: 1,
					breakfast_included: true
				}
			}
		});
		await e2e.addReceipt({
			...common,
			fileName: 'essen.pdf',
			vendor: 'Gasthaus Beispiel',
			amountCents: 6_400,
			documentDate: '2025-04-08',
			extraction: { document_type: 'receipt', gross: 64, vat: [], travel: { kind: 'restaurant' } }
		});
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const receipt = (/** @type {string} */ name) =>
		page.getByTestId('receipt').filter({ hasText: name });
	const detail = page.getByTestId('receipt-detail');

	// A restaurant bill is offered as hospitality, not asked about as travel.
	await receipt('Gasthaus Beispiel').click();
	await expect(detail.getByTestId('hospitality-looks-like')).toBeVisible();
	await expect(detail.getByTestId('travel-looks-like')).toHaveCount(0);

	// The ticket as read, and a new trip from it with its times and destination.
	await receipt('Bahn Beispiel AG').click();
	await expect(detail.getByTestId('travel-read')).toContainText(
		'Bahnticket · Beispielstadt Hbf → Musterstadt Hbf · 08.04.2025 07:12 – 08.04.2025 10:48'
	);
	await expect(detail.getByTestId('travel-looks-like')).toContainText('Als Bahnticket gelesen');
	await detail.getByTestId('travel-open').click();
	await detail.getByTestId('travel-new-trip').click();
	await expect(page.getByTestId('reise-destination')).toHaveValue('Musterstadt Hbf');
	await expect(page.getByTestId('reise-start')).toHaveValue('2025-04-08T07:12');
	await expect(page.getByTestId('reise-end')).toHaveValue('2025-04-09T20:41');
	await expect(page.getByTestId('reise-sum-allowance')).toHaveText('28,00 EUR');

	// The hotel invoice to the trip: its breakfast is proposed, and taken.
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await receipt('Hotel Beispiel').click();
	await expect(detail.getByTestId('travel-read')).toContainText('Frühstück inklusive');
	await detail.getByTestId('travel-open').click();
	await detail.getByTestId('travel-assign').click();
	await detail.getByTestId('travel-trip-link').click();
	await expect(page.getByTestId('reise-breakfast-proposal')).toContainText('09.04.2025');
	await page.getByTestId('reise-breakfast-take').click();
	await expect(page.getByTestId('reise-meal-2025-04-09-breakfast')).toBeChecked();
	await page.getByTestId('reise-save').click();
	await expect(page.getByTestId('reise-saved')).toBeVisible();
	await expect(page.getByTestId('reise-breakfast-proposal')).toHaveCount(0);
	await expect(page.getByTestId('reise-sum-allowance')).toHaveText('22,40 EUR');
});
