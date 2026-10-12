import { describe, expect, it } from 'vitest';

import { guessTravel, receiptWords } from './words.js';
import { guessedTravel, isTravelReceipt, travelKind } from './view.js';

// Made-up lines as receipts print them; no real vendor, person or booking.

describe('travel by its words, without AI (#366)', () => {
	it('tells the kind in eleven languages', () => {
		const cases = /** @type {[string, string][]} */ ([
			['Ihre Fahrkarte für die Fahrt nach Musterstadt', 'train'],
			['Boarding Pass · Flight XA 211', 'flight'],
			['Электронный билет на поезд № 7012345678901', 'train'],
			['Посадочный талон, рейс XA 211', 'flight'],
			['Квиток на потяг Київ – Львів', 'train'],
			['Bilet kolejowy · pociąg IC 1234', 'train'],
			['Jízdenka na vlak Praha – Brno', 'train'],
			['Otobüs bileti · Örnek Turizm', 'bus'],
			['OTEL faturası, konaklama 2 gece', 'hotel'],
			['فندق المثال · فاتورة', 'hotel'],
			['تذكرة طيران · رحلة XA 211', 'flight'],
			['Tarjeta de embarque · vuelo XY1234', 'flight'],
			['Biglietto ferroviario Roma – Milano', 'train'],
			["Carte d'embarquement · vol XA 211", 'flight'],
			['Facture Hôtel Exemple, 2 nuits', 'hotel'],
			['Tankstelle Beispiel · Super E10 45,2 l', 'fuel'],
			['Parkhaus am Markt · Parkschein', 'parking'],
			['Ristorante Esempio · coperto', 'restaurant'],
			['Taxi Beispiel · Fahrt zum Bahnhof', 'taxi'],
			['Mietwagen · Rental Agreement 4711', 'rental_car'],
			['Konferenz Beispiel 2026 · Teilnahme', 'event']
		]);
		for (const [text, kind] of cases) expect(guessTravel(text)?.kind, text).toBe(kind);
	});

	it('names the words it found; the most words win, a plain ticket comes last', () => {
		expect(guessTravel('Bordkarte und Flugschein, E-Ticket')).toEqual({
			kind: 'flight',
			words: ['bordkarte', 'flugschein']
		});
		expect(guessTravel('Ihr Ticket')?.kind).toBe('ticket');
		expect(guessTravel('Billet · train ticket')?.kind).toBe('train');
	});

	it('accents, capitals and Turkish letters do not matter; words inside others do', () => {
		expect(guessTravel('HÔTEL EXEMPLE')?.kind).toBe('hotel');
		expect(guessTravel('KONAKLAMA BEDELİ')?.kind).toBe('hotel');
		expect(guessTravel('Bahnfahrkarte Flexpreis')?.kind).toBe('train');
	});

	it('finds nothing where nothing is: business, services, a tax, an empty text', () => {
		for (const text of [
			'Business Plan, Software-Service, Abonnement',
			'Rechnung 2026-07 Hosting Paket M',
			'Volume license, devolo adapter',
			'Taxe sur la valeur ajoutée',
			'',
			'   '
		]) {
			expect(guessTravel(text), text).toBeNull();
		}
	});

	it('a receipt’s own words: file name, subject, sender, excerpt, vendor', () => {
		const r = {
			fileName: 'quittung.pdf',
			subject: 'Ваш электронный билет',
			from: 'noreply@example.test',
			excerpt: null,
			vendor: 'Поезда Пример'
		};
		expect(receiptWords(r)).toBe(
			'quittung.pdf\nВаш электронный билет\nnoreply@example.test\nПоезда Пример'
		);
		expect(guessTravel(receiptWords(r))?.kind).toBe('ticket');
	});

	it('on a receipt: a reading wins over words; words give a kind, never a question', () => {
		const mail = { id: 'm', status: 'neu', subject: 'Ihre Fahrkarte nach Musterstadt' };
		expect(travelKind(mail)).toBe('train');
		expect(guessedTravel(mail)).toEqual({ kind: 'train', words: ['fahrkarte'] });
		expect(isTravelReceipt(mail)).toBe(false);

		const read = {
			...mail,
			extraction: { document_type: 'invoice', travel: { kind: 'hotel' } }
		};
		expect(travelKind(read)).toBe('hotel');
		expect(guessedTravel(read)).toBeNull();
		expect(isTravelReceipt(read)).toBe(true);

		// What this device found in the PDF once counts before the file name.
		const pdf = {
			id: 'p',
			fileName: 'scan.pdf',
			travelGuess: { kind: 'flight', words: ['boarding pass'] }
		};
		expect(travelKind(pdf)).toBe('flight');
		// Looked once and found nothing: the file name may still tell.
		const none = { id: 'n', fileName: 'Parkschein.pdf', travelGuess: { kind: null, words: [] } };
		expect(travelKind(none)).toBe('parking');
	});
});
