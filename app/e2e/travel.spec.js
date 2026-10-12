// Travel (#213, step 3), end to end: a ticket asks for its trip; a new trip
// gets its times, a breakfast provided and a drive in a family member's car;
// the ticket is assigned to it as paid privately, a restaurant bill gets its
// hospitality details; the trip and the month add it all up. Every vendor,
// place, person and amount is made up.
import { test, expect } from '@playwright/test';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';
import { makePdf } from '@belege/bridge/testing/pdf';

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
		page.getByTestId('reisen-question').filter({ hasText: 'Reisebeleg ohne Reise' })
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

test('without AI: a PDF’s words and a mail’s subject hint at travel, read on this device (#366)', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const pdf = [
		...makePdf([
			'Bahn Beispiel AG',
			'Ihre Fahrkarte',
			'Beispielstadt Hbf - Musterstadt Hbf',
			'89,90 EUR'
		])
	];
	await page.evaluate(async (pdf) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		// Not read: no extraction, as without a model.
		await e2e.addReceiptFile(pdf, {
			source: 'upload',
			status: 'neu',
			fileName: 'scan-0815.pdf',
			mime: 'application/pdf',
			documentDate: '2025-05-06'
		});
		await e2e.addReceipt({
			source: 'mail',
			status: 'neu',
			fileName: null,
			subject: 'Ваш электронный билет на поезд',
			from: 'noreply@example.test',
			receivedAt: '2025-05-07T08:00:00Z'
		});
	}, pdf);

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const detail = page.getByTestId('receipt-detail');

	// The PDF: its text read here, the word found and kept.
	await page.getByTestId('receipt').filter({ hasText: 'scan-0815.pdf' }).click();
	const pdfHint = detail.getByTestId('travel-looks-like');
	await expect(pdfHint).toHaveAttribute('data-by', 'words');
	await expect(pdfHint).toContainText('Art nach Stichworten: Bahnticket („fahrkarte“)');

	// The mail: its Russian subject is enough.
	await page.getByTestId('receipt').filter({ hasText: 'noreply@example.test' }).click();
	await expect(detail.getByTestId('travel-looks-like')).toContainText('Bahnticket');

	// Words give a hint, not a question.
	await page.getByTestId('belege-reisen').click();
	await expect(page.getByTestId('reisen-questions')).toHaveCount(0);
});

test('trips proposed by the receipts: one made with a click, one dismissed for good (#213, step 4b)', async ({
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
		/** @param {string} vendor @param {string} day @param {number} cents @param {Record<string, any>} travel */
		const add = (vendor, day, cents, travel) =>
			e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				currency: 'EUR',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: cents,
				documentDate: day,
				extraction: { document_type: 'invoice', gross: cents / 100, vat: [], travel }
			});
		// Bought in March, travelled in April: the day of travel counts.
		await add('Bahn Hin Beispiel', '2025-03-20', 4990, {
			kind: 'train',
			from: 'A-Stadt Hbf',
			to: 'Musterstadt Hbf',
			departure: '2025-04-08T07:12',
			arrival: '2025-04-08T10:48'
		});
		await add('Hotel Beispiel', '2025-04-09', 11200, {
			kind: 'hotel',
			place: 'Musterstadt',
			check_in: '2025-04-08',
			check_out: '2025-04-09',
			nights: 1,
			breakfast_included: true
		});
		await add('Bahn Zurück Beispiel', '2025-04-01', 4990, {
			kind: 'train',
			from: 'Musterstadt Hbf',
			to: 'A-Stadt Hbf',
			departure: '2025-04-09T17:10',
			arrival: '2025-04-09T20:41'
		});
		await add('Gasthaus Beispiel', '2025-04-08', 3800, { kind: 'restaurant' });
		// Another week: a day trip, to be dismissed.
		await add('Bus Beispiel', '2025-04-22', 1900, {
			kind: 'bus',
			from: 'A-Stadt',
			to: 'B-Dorf',
			departure: '2025-04-22T08:00',
			arrival: '2025-04-22T09:30'
		});
		// May: shown as a proposal in another month.
		await add('Flug Beispiel', '2025-05-02', 21000, {
			kind: 'flight',
			from: 'A-Stadt',
			to: 'C-Hafen',
			departure: '2025-05-12T06:00',
			arrival: '2025-05-12T08:00'
		});
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('belege-reisen').click();
	const picker = page.getByTestId('reisen-month');
	await picker.getByLabel('Monat: Jahr').selectOption('2025');
	await picker.getByLabel('Monat: Monat').selectOption('04');

	const proposals = page.getByTestId('reisen-proposal');
	await expect(proposals).toHaveCount(2);
	await expect(page.getByTestId('reisen-proposals-elsewhere')).toContainText('1');
	const trip = proposals.filter({ hasText: 'Musterstadt' });
	await expect(trip.getByTestId('reisen-proposal-title')).toHaveText(
		'Reise nach Musterstadt, 08.04.2025 07:12 – 09.04.2025 20:41'
	);
	await expect(trip.getByRole('link')).toHaveCount(4);

	// The day trip is no trip: dismissed, and not offered again.
	await proposals.filter({ hasText: 'B-Dorf' }).getByTestId('reisen-proposal-dismiss').click();
	await expect(proposals).toHaveCount(1);

	// The other one becomes a trip, its receipts assigned, the breakfast proposed.
	await trip.getByTestId('reisen-proposal-accept').click();
	await expect(page.getByTestId('reise-destination')).toHaveValue('Musterstadt');
	await expect(page.getByTestId('reise-start')).toHaveValue('2025-04-08T07:12');
	await expect(page.getByTestId('reise-end')).toHaveValue('2025-04-09T20:41');
	await expect(page.getByTestId('reise-receipt')).toHaveCount(4);
	await expect(page.getByTestId('reise-breakfast-proposal')).toContainText('09.04.2025');

	// Back on Reisen: April proposes nothing more, May still its flight.
	await page.getByRole('link', { name: '← Alle Reisen' }).click();
	await picker.getByLabel('Monat: Jahr').selectOption('2025');
	await picker.getByLabel('Monat: Monat').selectOption('04');
	await expect(page.getByTestId('reisen-proposals')).toHaveCount(0);
	await expect(page.getByTestId('reisen-trip')).toHaveCount(1);
	await page.getByTestId('reisen-proposals-go').click();
	await expect(proposals).toHaveCount(1);
	await expect(proposals).toContainText('C-Hafen');
});

test('the month’s statement: checks first, then a numbered PDF kept as a receipt, and a correction (#213, step 5)', async ({
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
		/** @param {string} vendor @param {Record<string, any>} travel */
		const add = (vendor, travel) =>
			e2e.addReceipt({
				source: 'upload',
				status: 'ausgelesen',
				currency: 'EUR',
				fileName: `${vendor}.pdf`,
				vendor,
				amountCents: 4990,
				documentDate: '2025-06-01',
				extraction: {
					document_type: 'ticket',
					gross: 49.9,
					vat: [{ rate: 7, amount: 3.26 }],
					travel
				}
			});
		await add('Bahn Hin Beispiel', {
			kind: 'train',
			from: 'A-Stadt',
			to: 'Musterstadt',
			departure: '2025-06-10T07:00',
			arrival: '2025-06-10T09:30'
		});
		await add('Bahn Zurück Beispiel', {
			kind: 'train',
			from: 'Musterstadt',
			to: 'A-Stadt',
			departure: '2025-06-10T17:00',
			arrival: '2025-06-10T19:30'
		});
	});

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('belege-reisen').click();
	const picker = page.getByTestId('reisen-month');
	const june = async () => {
		await picker.getByLabel('Monat: Jahr').selectOption('2025');
		await picker.getByLabel('Monat: Monat').selectOption('06');
	};
	await june();
	await page.getByTestId('reisen-proposal-accept').click();
	await expect(page.getByTestId('reise-destination')).toHaveValue('Musterstadt');

	// The trip has no reason yet: the statement is refused, and says why.
	await page.getByRole('link', { name: '← Alle Reisen' }).click();
	await june();
	const statement = page.getByTestId('reisen-statement');
	await expect(statement.locator('[data-code="tripWithoutReason"]')).toContainText(
		'Reise ohne geschäftlichen Anlass'
	);
	await expect(statement.getByTestId('reisen-statement-make')).toBeDisabled();

	// The gap closed on the trip's page.
	await statement.locator('[data-code="tripWithoutReason"] a').click();
	await page.getByTestId('reise-reason').fill('Workshop Kundin Beispiel UG');
	await page.getByTestId('reise-save').click();
	await expect(page.getByTestId('reise-saved')).toBeVisible();
	await page.getByRole('link', { name: '← Alle Reisen' }).click();
	await june();

	// 14 EUR for a day of 12.5 hours, and two tickets paid privately.
	await expect(statement.getByTestId('reisen-statement-amount')).toHaveText('113,80 EUR');
	await expect(statement.getByTestId('reisen-statement-noname')).toBeVisible();
	await statement.getByTestId('reisen-statement-name').fill('Inhaberin Beispiel');
	await statement.getByTestId('reisen-statement-make').click();
	const made = page.getByTestId('reisen-statement-closed');
	await expect(made).toHaveCount(1);
	await expect(made).toContainText('RK-2025-001');
	await expect(made).toContainText('113,80 EUR');

	// The PDF is a receipt now.
	await made.getByRole('link').click();
	await expect(page.getByTestId('receipt-detail')).toContainText(
		'Reisekostenabrechnung Inhaberin Beispiel'
	);

	// A correction: a new number, the first one kept and marked replaced.
	await page.getByTestId('belege-reisen').click();
	await june();
	await page.getByTestId('reisen-statement-correct').click();
	await expect(statement).toContainText('Korrektur von RK-2025-001');
	await statement.getByTestId('reisen-statement-make').click();
	await expect(made).toHaveCount(2);
	await expect(made.first()).toContainText('RK-2025-002');
	await expect(made.nth(1)).toContainText('ersetzt');
});

test('receipts named on the travel pages are previewed on hover', async ({ page }) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const pdf = [...makePdf(['Bahn Beispiel AG', 'Fahrkarte', 'Musterstadt Hbf', '49,90 EUR'])];
	await page.evaluate(async (pdf) => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addReceiptFile(pdf, {
			source: 'upload',
			status: 'ausgelesen',
			mime: 'application/pdf',
			fileName: 'bahn.pdf',
			vendor: 'Bahn Beispiel AG',
			amountCents: 4990,
			currency: 'EUR',
			documentDate: '2025-07-01',
			// A ticket read without its journey's times: asked about, proposing nothing.
			extraction: { document_type: 'ticket', gross: 49.9, vat: [] }
		});
	}, pdf);

	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('belege-reisen').click();
	const question = page.getByTestId('reisen-question').filter({ hasText: 'Bahn Beispiel AG' });
	const peek = page.getByTestId('receipt-peek');
	await question.hover();
	await expect(peek).toBeVisible();
	await expect(peek).toContainText('Bahn Beispiel AG');
	await expect(peek.getByTestId('tx-receipt-preview')).toHaveAttribute('data-rendered', 'true');
	await page.mouse.move(5, 5);
	await expect(peek).toHaveCount(0);

	// The same on a trip's page, for its receipts.
	await question.click();
	const detail = page.getByTestId('receipt-detail');
	await detail.getByTestId('travel-open').click();
	await detail.getByTestId('travel-new-trip').click();
	const receipt = page.getByTestId('reise-receipt');
	await expect(receipt).toHaveCount(1);
	await receipt.hover();
	await expect(peek).toBeVisible();
	await expect(peek.getByTestId('tx-receipt-preview')).toHaveAttribute('data-rendered', 'true');
});

test('a ticket in rubles counts in euros by its rate, never its rubles as euros', async ({
	page
}) => {
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	// A made-up conference ticket, read as an event in rubles.
	await page.evaluate(async () => {
		const e2e = /** @type {any} */ (window).__belegeE2E;
		await e2e.addReceipt({
			source: 'upload',
			status: 'ausgelesen',
			fileName: 'konferenz.pdf',
			vendor: 'Konferenz Beispiel',
			amountCents: 1_499_000,
			currency: 'RUB',
			documentDate: '2025-04-23',
			extraction: {
				document_type: 'ticket',
				gross: 14990,
				currency: 'RUB',
				vat: [],
				travel: { kind: 'event' }
			}
		});
	});
	await page.getByRole('navigation').getByRole('link', { name: 'Belege' }).click();
	await page.getByTestId('year-switch').selectOption('2025');
	const detail = page.getByTestId('receipt-detail');
	await page.getByTestId('receipt').filter({ hasText: 'Konferenz Beispiel' }).click();
	await detail.getByTestId('travel-open').click();
	await detail.getByTestId('travel-new-trip').click();
	await page.getByTestId('reise-destination').fill('Moskau');
	await page.getByTestId('reise-reason').fill('Konferenz Beispiel');
	await page.getByTestId('reise-save').click();
	await expect(page.getByTestId('reise-saved')).toBeVisible();

	// No rate yet: no euros, and nothing of the rubles paid back.
	await expect(page.getByTestId('reise-receipt-amount')).toHaveText('14.990,00 RUB → Kurs fehlt');
	await expect(page.getByTestId('reise-sum-private')).toHaveText('0,00 EUR');
	await expect(page.getByTestId('reise-sum-norate')).toBeVisible();
	await page.getByRole('link', { name: '← Alle Reisen' }).click();
	const picker = page.getByTestId('reisen-month');
	await picker.getByLabel('Monat: Jahr').selectOption('2025');
	await picker.getByLabel('Monat: Monat').selectOption('04');
	await expect(
		page.getByTestId('reisen-statement').locator('[data-code="foreignWithoutRate"]')
	).toBeVisible();
	await expect(page.getByTestId('reisen-statement-make')).toBeDisabled();

	// The rate on the receipt, as people say it: 1 EUR = 95,23 RUB.
	await page.getByTestId('reisen-statement').locator('[data-code="foreignWithoutRate"] a').click();
	await expect(detail.getByTestId('travel-euro-missing')).toBeVisible();
	await detail.getByTestId('travel-euro-rate').fill('95,23');
	await expect(detail.getByTestId('travel-euro-preview')).toContainText('157,41 EUR');
	await detail.getByTestId('travel-euro-keep').click();
	await expect(detail.getByTestId('travel-euro-value')).toContainText(
		'In Euro: 157,41 EUR (14.990,00 RUB zu 95,23 RUB je 1 EUR).'
	);
	await detail.getByTestId('travel-trip-link').click();
	await expect(page.getByTestId('reise-receipt-amount')).toHaveText('14.990,00 RUB → 157,41 EUR');
	await expect(page.getByTestId('reise-sum-private')).toHaveText('157,41 EUR');
	await expect(page.getByTestId('reise-sum-norate')).toHaveCount(0);
});
