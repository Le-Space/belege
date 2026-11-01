// A company credit card settled from the bank (#382, step 2): the monthly
// debit is an own transfer to the card's account – paired with the card's
// settlement line where its statement has one, else known by the card's last
// four digits and a card word. Made-up accounts and amounts.
import { describe, expect, it } from 'vitest';

import { buildMatchingContext } from './context.js';
import { classifyTransaction } from './classify.js';
import { classificationLine } from './explain.js';

const BANK = {
	id: 'BANK',
	source: 'hibiscus',
	ibanLast4: '0042',
	name: 'Geschäftskonto',
	currency: 'EUR'
};
const CARD = {
	id: 'CARD',
	source: 'card',
	kind: 'card',
	ibanLast4: '4242',
	name: 'Firmenkarte Beispiel',
	currency: 'EUR'
};

/** @param {string} id @param {string} accountId @param {string} day @param {number} cents @param {Record<string, any>} [over] */
const tx = (id, accountId, day, cents, over = {}) => ({
	id,
	accountId,
	source: accountId === 'CARD' ? 'card' : 'hibiscus',
	bookedOn: day,
	amountCents: cents,
	currency: 'EUR',
	counterparty: '',
	counterpartyIban: '',
	purpose: '',
	bookingType: '',
	...over
});

/** @param {Record<string, any>[]} transactions @param {Record<string, any>[]} [accounts] */
const classify = async (transactions, accounts = [BANK, CARD]) => {
	const ctx = await buildMatchingContext({ accounts, transactions, settings: null });
	return Object.fromEntries(transactions.map((t) => [t.id, classifyTransaction(t, ctx)]));
};

describe('a credit card settled from the bank (#382)', () => {
	it('paired with the card’s settlement line: both sides an own transfer', async () => {
		const c = await classify([
			tx('DEBIT', 'BANK', '2026-06-02', -132463, { purpose: 'Lastschrift Beispielbank' }),
			tx('SETTLE', 'CARD', '2026-05-31', 132463, {
				counterparty: 'Zahlung erhalten - Danke',
				bookingType: 'Kartenausgleich'
			})
		]);
		expect(c.DEBIT).toMatchObject({
			kind: 'own-transfer',
			via: 'counter-booking',
			counterBookingId: 'SETTLE',
			sign: 'Kartenausgleich'
		});
		expect(c.SETTLE).toMatchObject({ kind: 'own-transfer', counterBookingId: 'DEBIT' });
	});

	it('without a settlement line: by the card’s last digits and a card word', async () => {
		const c = await classify([
			tx('DEBIT', 'BANK', '2026-06-02', -132463, {
				counterparty: 'Beispielbank',
				purpose: 'VISA Kartenabrechnung 4242 Mai 2026'
			})
		]);
		expect(c.DEBIT).toMatchObject({
			kind: 'own-transfer',
			via: 'card',
			counterAccountId: 'CARD',
			ibanLast4: '4242'
		});
		expect(classificationLine(c.DEBIT, { accounts: [BANK, CARD] })).toContain(
			'Ausgleich deiner Kreditkarte Firmenkarte Beispiel'
		);
	});

	it('a settlement line a week from its debit: linked by the digits; alone, no receipt either', async () => {
		const c = await classify([
			tx('DEBIT', 'BANK', '2026-06-08', -50000, { purpose: 'Kreditkarte ****4242' }),
			tx('SETTLE', 'CARD', '2026-05-31', 50000, {
				counterparty: 'Zahlung erhalten',
				bookingType: 'Kartenausgleich'
			})
		]);
		expect(c.DEBIT).toMatchObject({
			via: 'card',
			counterBookingId: 'SETTLE',
			counterDay: '2026-05-31'
		});
		expect(c.SETTLE).toMatchObject({ kind: 'own-transfer', via: 'card-settlement' });
		expect(classificationLine(c.SETTLE, { accounts: [BANK, CARD] })).toContain(
			'Ausgleich der Kreditkarte vom Bankkonto'
		);
	});

	it('four digits alone, another card’s, or two cards alike: no transfer', async () => {
		const c = await classify([
			// A vendor's invoice that happens to carry the digits.
			tx('INVOICE', 'BANK', '2026-06-02', -4242, {
				counterparty: 'Wolkenfabrik Hosting GmbH',
				purpose: 'Rechnung 4242'
			}),
			// A card word, but digits of no card of ours.
			tx('OTHER', 'BANK', '2026-06-02', -9900, { purpose: 'VISA Kartenabrechnung 1111' }),
			// A charge on the card itself is no debit of the card.
			tx('CHARGE', 'CARD', '2026-05-03', -8990, { counterparty: 'Bahn Beispiel AG 4242 Karte' })
		]);
		expect(c.INVOICE).toBeNull();
		expect(c.OTHER).toBeNull();
		expect(c.CHARGE).toBeNull();
		const twins = await classify(
			[tx('DEBIT', 'BANK', '2026-06-02', -100, { purpose: 'Kreditkarte 4242' })],
			[BANK, CARD, { ...CARD, id: 'CARD2', name: 'Zweite Karte' }]
		);
		expect(twins.DEBIT).toBeNull();
	});
});
