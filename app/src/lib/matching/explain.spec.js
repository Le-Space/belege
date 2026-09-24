// "Warum diese Zuordnung?" in words, from the stored reasons and score.
import { describe, expect, it } from 'vitest';

import {
	candidateLine,
	classificationLine,
	matchLine,
	pointsBreakdown,
	reasonsText
} from './explain.js';

const tx = { id: 'T1', amountCents: -1546, currency: 'EUR', bookedOn: '2026-09-02' };
const receipt = {
	id: 'R1',
	vendor: 'Hetzner Online GmbH',
	invoiceNumber: '082001098720',
	extraction: { customer_number: 'K-4711' }
};
/** Intl puts a no-break space before the currency code. */
const plain = (/** @type {string} */ s) => s.replace(/\u00a0/g, ' ');

describe('matchLine', () => {
	it('an automatic match: every reason with its value, the points, how', () => {
		expect(
			plain(
				matchLine(
					{ state: 'auto', score: 120, reasons: ['amount', 'invoice-number', 'vendor', 'date'] },
					{ tx, receipt }
				)
			)
		).toBe(
			'Betrag gleich (-15,46 EUR) · Rechnungsnummer 082001098720 im Verwendungszweck · Anbieter Hetzner Online GmbH · Datum passt – 120 Punkte, automatisch zugeordnet'
		);
	});

	it('confirmed by the person, linked by hand, no score', () => {
		expect(matchLine({ state: 'confirmed', score: 70, reasons: ['vendor'] }, { receipt })).toBe(
			'Anbieter Hetzner Online GmbH – 70 Punkte, von dir bestätigt'
		);
		expect(matchLine({ state: 'confirmed', score: null, reasons: ['manual'] })).toBe(
			'von dir zugeordnet'
		);
	});

	it('the other reasons, and without the facts', () => {
		expect(
			reasonsText(['customer-number', 'iban', 'vendor-in-purpose', 'far-date', 'wrong-direction'], {
				receipt
			})
		).toBe(
			'Kundennummer K-4711 im Verwendungszweck · IBAN des Anbieters ist das Gegenkonto · Anbieter Hetzner Online GmbH im Verwendungszweck · Datum liegt weit weg · Richtung passt nicht (Eingang statt Ausgang oder umgekehrt)'
		);
		expect(reasonsText(['amount', 'invoice-number', 'vendor'])).toBe(
			'Betrag gleich · Rechnungsnummer im Verwendungszweck · Anbieter passt'
		);
	});

	it('the points behind the score, for the technical view', () => {
		expect(pointsBreakdown(['amount', 'invoice-number', 'vendor', 'date'], 120)).toBe(
			'Betrag +40 · Rechnungsnummer +50 · Anbieter +20 · Datum +10 = 120 Punkte'
		);
		expect(pointsBreakdown(['amount', 'far-date'], 10)).toBe(
			'Betrag +40 · Datum weit weg −30 = 10 Punkte'
		);
		expect(pointsBreakdown(['manual'], null)).toBe('');
	});

	it('a candidate of a question', () => {
		expect(
			plain(candidateLine({ score: 70, reasons: ['amount', 'vendor', 'date'] }, { tx, receipt }))
		).toBe('70 Punkte: Betrag gleich (-15,46 EUR) · Anbieter Hetzner Online GmbH · Datum passt');
	});
});

describe('classificationLine', () => {
	const accounts = [{ id: 'A', name: 'Geschäftskonto', ibanLast4: '1234' }];

	it('own transfers: by IBAN, by the counter-booking, by our company name', () => {
		expect(
			classificationLine({ kind: 'own-transfer', via: 'iban', ibanLast4: '1234' }, { accounts })
		).toBe('Eigene Umbuchung: Das Gegenkonto ist dein Konto Geschäftskonto ···1234');
		expect(classificationLine({ kind: 'own-transfer', via: 'iban', ibanLast4: '9999' })).toBe(
			'Eigene Umbuchung: Das Gegenkonto ist dein Konto ···9999'
		);
		expect(
			classificationLine({ kind: 'own-transfer', via: 'mirrored', ibanLast4: '1234' }, { accounts })
		).toBe(
			'Eigene Umbuchung: Das Gegenkonto endet wie dein Konto Geschäftskonto ···1234, und dort steht die Gegenbuchung'
		);
		expect(
			classificationLine({ kind: 'own-transfer', via: 'company', company: 'le space UG' })
		).toBe('Eigene Umbuchung: Die Gegenpartei ist deine Firma „le space UG“');
	});

	it('bank fee, loan, the person’s rules, their "Kein Beleg nötig"', () => {
		expect(classificationLine({ kind: 'bank-fee', bookingType: 'Abschluss' })).toBe(
			'Bankentgelt: Buchungsart „Abschluss“ – der Kontoauszug ist der Beleg'
		);
		expect(classificationLine({ kind: 'loan' })).toBe(
			'Darlehen: „Darlehen“ im Verwendungszweck – der Vertrag ist der Beleg'
		);
		expect(
			classificationLine({
				kind: 'rule-ignore',
				ruleField: 'counterparty',
				ruleContains: 'Finanzamt',
				reason: 'Bescheid liegt vor'
			})
		).toBe('Eigene Anweisung: Gegenpartei enthält „Finanzamt“ → ignoriert (Bescheid liegt vor)');
		expect(
			classificationLine({
				kind: 'rule-private',
				ruleField: 'purpose',
				ruleContains: 'Taschengeld',
				reason: 'Taschengeld'
			})
		).toBe('Eigene Anweisung: Verwendungszweck enthält „Taschengeld“ → privat (Taschengeld)');
		expect(classificationLine(null, { noReceipt: { reason: 'Bewirtung' } })).toBe(
			'Von dir entschieden: Kein Beleg nötig – Bewirtung'
		);
		expect(classificationLine(null)).toBeNull();
	});
});
