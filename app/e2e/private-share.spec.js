// A payment that is partly private use (#935): the books' rule for telephone
// and internet bills is set, a bill is suggested with its share, the person
// takes it, and the next bill of the vendor's is suggested as the last one
// was booked – also when that was another share than the rule's. No bridge:
// the share comes from the rule and from what was confirmed, not from a
// model. All vendors and amounts made up.
import { test, expect } from '@playwright/test';
import { openSettings } from './settings.js';
import { addVirtualAuthenticator } from './webauthn.js';
import { acceptConsent } from './consent.js';

test('a telephone bill is suggested with its private share and booked in two parts', async ({
	page
}) => {
	/** @param {string} name */
	const tab = (name) =>
		page.getByRole('navigation', { name: 'Hauptnavigation' }).getByRole('link', { name });
	await addVirtualAuthenticator(page);
	await page.goto('/');
	await acceptConsent(page);
	await page.getByTestId('passkey-label').fill('E2E Privatanteil');
	await page.getByRole('button', { name: 'Passkey anlegen' }).click();
	await expect(page.getByTestId('own-did')).toBeVisible();

	const add = (/** @type {Record<string, any>} */ booking) =>
		page.evaluate((b) => /** @type {any} */ (window).__belegeE2E.addTransaction(b), booking);
	await add({
		bookedOn: '2026-10-13',
		counterparty: 'Kabelnetz Beispiel GmbH',
		purpose: 'DSL 100 Rechnung 10/2026',
		amountCents: -3999
	});
	await add({
		bookedOn: '2026-10-14',
		counterparty: 'Funknetz Test AG',
		purpose: 'Mobilfunk Tarif M 10/2026',
		amountCents: -1499
	});
	await add({
		bookedOn: '2026-10-15',
		counterparty: 'Wolkenfabrik Hosting GmbH',
		purpose: 'Server 10/2026',
		amountCents: -2000
	});

	// Before the rule is set: no share is suggested for anything.
	await tab('Zahlungen').click();
	await page.getByTestId('filter-all').click();
	await page.getByText('Kabelnetz Beispiel GmbH').first().click();
	const booking = page.getByTestId('tx-booking');
	const share = booking.getByTestId('tx-booking-share');
	await expect(share.getByTestId('tx-booking-share-percent')).toHaveValue('');
	await expect(share.getByTestId('tx-booking-share-note')).toContainText(
		'die ganze Zahlung ist betrieblich'
	);
	await page.getByTestId('tx-detail-close').click();

	// The books' rule: half of a landline bill, 30 % of a mobile one, on 1390.
	await openSettings(page, 'buchhaltung');
	await page.getByTestId('datev-share-landline').fill('50');
	await page.getByTestId('datev-share-mobile').fill('30');
	await page.getByTestId('datev-share-account').fill('1390');
	await page.getByTestId('matching-save').click();
	await expect(page.getByTestId('matching-saved')).toBeVisible();

	// The landline bill: 50 % suggested, by the rule, with the two parts in euros.
	await tab('Zahlungen').click();
	await page.getByTestId('filter-all').click();
	await page.getByText('Kabelnetz Beispiel GmbH').first().click();
	await expect(share).toHaveAttribute('data-via', 'landline');
	await expect(share.getByTestId('tx-booking-share-percent')).toHaveValue('50');
	await expect(share.getByTestId('tx-booking-share-account')).toHaveValue('1390');
	const note = share.getByTestId('tx-booking-share-note');
	await expect(note).toContainText('betrieblich 19,99');
	await expect(note).toContainText('privat 20,00');
	await expect(note).toContainText('Regel für Festnetz und Internetanschluss');
	// Nothing is booked by the suggestion.
	await expect(booking).toHaveAttribute('data-confirmed', 'false');

	// A share on the expense's own account cannot be: said, and not taken.
	await booking.getByTestId('tx-booking-account').fill('1390');
	await expect(note).toContainText('anderes Konto');
	await expect(booking.getByTestId('tx-booking-confirm')).toBeDisabled();

	// The person takes it with another share than the rule's.
	await booking.getByTestId('tx-booking-account').fill('4920');
	await share.getByTestId('tx-booking-share-percent').fill('40');
	await expect(note).toContainText('betrieblich 23,99');
	await expect(note).toContainText('privat 16,00');
	await booking.getByTestId('tx-booking-confirm').click();
	await expect(booking).toHaveAttribute('data-confirmed', 'true');
	await expect(share.getByTestId('tx-booking-share-percent')).toHaveValue('40');
	await page.getByTestId('tx-detail-close').click();

	// The mobile bill: 30 %, by the rule for mobile.
	await page.getByText('Funknetz Test AG').first().click();
	await expect(share).toHaveAttribute('data-via', 'mobile');
	await expect(share.getByTestId('tx-booking-share-percent')).toHaveValue('30');
	await expect(share.getByTestId('tx-booking-share-note')).toContainText('Regel für Mobilfunk');
	await page.getByTestId('tx-detail-close').click();

	// A hosting bill is no telephone bill: no share.
	await page.getByText('Wolkenfabrik Hosting GmbH').first().click();
	await expect(share).toHaveAttribute('data-via', '');
	await expect(share.getByTestId('tx-booking-share-percent')).toHaveValue('');
});
