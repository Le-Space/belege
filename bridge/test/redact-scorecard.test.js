// A scorecard for the redaction (llm/redact.js, issue #226): made-up documents
// of the kinds Belege reads, and for each what must be hidden, what must stay
// because reading and matching a receipt need it, and which gaps are known.
// A known gap is asserted as still sent: whoever closes one moves it to
// `hidden`, and whoever opens one sees this fail. Nothing here is real.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanExtraTerms, redact, withExtraTerms } from '../src/llm/redact.js';

// As `pnpm setup:llm` asks: the own names; the own mail domain comes from the mail setup.
const options = {
	terms: ['Erika Mustermann', 'Mustermann'],
	ownDomains: ['beispiel-gmbh.example']
};

const DOCUMENTS = {
	'a German invoice': {
		text: `Wolkenfabrik Hosting GmbH
Serverweg 12
10115 Berlin
USt-IdNr. DE123456789 · Steuernummer 30/123/45678
Tel. +49 30 7654321 · Ansprechpartner: Jonas Beispiel · jonas.beispiel@wolkenfabrik.example

Beispiel GmbH
Frau Erika Mustermann
Lindenstraße 5
20095 Hamburg

Rechnung RE-2026-0042 · Kundennummer 778899 · Datum 02.03.2026
Hosting Paket M, Projekt "Kundenportal Nordlicht AG"   100,00 EUR
USt 19 %  19,00 EUR   Brutto 119,00 EUR
Zahlbar per Lastschrift von DE89 3704 0044 0532 0130 00, Mandat M-5566
Gläubiger-ID DE98ZZZ09999999999
Ihre Rechnung online: https://kunden.wolkenfabrik.example/rechnung?token=abc123secret`,
		hidden: [
			'Erika',
			'Mustermann',
			'Lindenstraße 5',
			'Hamburg',
			'Serverweg 12',
			'0532 0130',
			'Jonas Beispiel',
			'jonas.beispiel@',
			'7654321',
			'30/123/45678',
			'abc123secret'
		],
		stays: [
			'Wolkenfabrik Hosting GmbH',
			'DE123456789',
			'RE-2026-0042',
			'778899',
			'02.03.2026',
			'119,00',
			'19,00',
			'DE98ZZZ09999999999',
			'wolkenfabrik.example',
			'…3000'
		],
		// A customer's name in an item line, and the mandate: text like any other.
		knownGaps: ['Nordlicht AG', 'M-5566']
	},
	'a train ticket': {
		text: `Online-Ticket · Auftragsnummer KX7P2Q
Reisende: Erika Mustermann, geb. 14.05.1985 · BahnCard 25 Nr. 7081 4111 2222 3333
Mitreisender: Paul Mustermann (Kind, 9 Jahre)
Hamburg Hbf 08:12 → München Hbf 14:05, ICE 787, Wagen 9 Platz 64
Preis 89,90 EUR inkl. 7 % MwSt 5,88 EUR
Zahlung: Kreditkarte **** **** **** 4242`,
		hidden: ['Erika', 'Paul', 'Mustermann', '14.05.1985', '7081 4111'],
		stays: ['Hamburg Hbf', 'München Hbf', '89,90', '5,88', 'KX7P2Q', '…3333'],
		knownGaps: []
	},
	'a mail from a freelancer': {
		text: `Von: Dr. Anna Schreiber <anna.schreiber@freiberuf.example>
An: buchhaltung@beispiel-gmbh.example
Hallo Erika, anbei meine Rechnung 2026-07 über 1.500,00 EUR für das Gutachten im Fall Meyer ./. Schulze.
Bitte überweise auf mein Konto bei der Sparkasse, IBAN DE02120300000000202051, BIC BYLADEM1001.
Meine Steuer-ID ist 12 345 678 901. Mobil: 0171 2345678.
Viele Grüße, Anna
Dr. Anna Schreiber · Am Hang 3 · 80331 München`,
		hidden: [
			'anna.schreiber@',
			'buchhaltung@',
			'Hallo Erika',
			'0000202051',
			'12 345 678 901',
			'0171 2345678',
			'80331'
		],
		stays: ['2026-07', '1.500,00', 'freiberuf.example', '…2051'],
		// The vendor is a person here: her name has to go out, it is what is read.
		// Names in running text, and a street without a suffix on one line, are not found.
		knownGaps: ['Anna Schreiber', 'Meyer ./. Schulze', 'Am Hang 3']
	},
	'an English invoice from abroad': {
		text: `Example Cloud Ltd · 221B Example Street, London NW1 6XE, United Kingdom · VAT GB123456789
Bill to: Beispiel GmbH, Erika Mustermann, Lindenstrasse 5, 20095 Hamburg, Germany
Invoice INV-99812 · Account ID acct_1Hh2k3 · Seats: 3 (erika@beispiel-gmbh.example, extern@partner.example)
Total USD 87.00 · Reverse charge · Paid with Visa ending 4242`,
		hidden: ['Erika Mustermann', 'Lindenstrasse 5', 'Hamburg', 'erika@', 'extern@'],
		stays: ['Example Cloud Ltd', 'GB123456789', 'INV-99812', '87.00', 'Reverse charge'],
		// An address in another country's form.
		knownGaps: ['221B Example Street', 'NW1 6XE']
	},
	'an Austrian receipt': {
		text: `Alpen Software GmbH
Hauptplatz 1
4020 Linz
UID ATU12345678
Rechnung an: Beispiel GmbH, z. Hd. E. Mustermann, Lindenstr. 5, D-20095 Hamburg
Lizenz 2026 Hosting Plus, Betrag 120,00 EUR inkl. 20 % USt`,
		hidden: ['Mustermann', '4020 Linz', 'Hauptplatz 1', 'Lindenstr. 5', 'Hamburg'],
		// A year in a sentence is no postcode.
		stays: ['Alpen Software GmbH', 'ATU12345678', '2026 Hosting Plus', '120,00'],
		knownGaps: []
	},
	'a hospitality receipt': {
		text: `Gasthaus Zur Linde · Dorfstraße 8 · 01067 Dresden · St.-Nr. 201/234/56789
Tisch 12 · Bedienung: Sabine
2x Tagesgericht 29,80  1x Wein 7,50  Summe 37,30 EUR  Trinkgeld 3,00
Bewirtete Personen: Herr Dr. Karl Auftraggeber (Nordlicht AG), Erika Mustermann
Anlass: Vertragsverhandlung Projekt Polaris`,
		hidden: ['Karl Auftraggeber', 'Sabine', 'Erika', 'Dorfstraße 8', '201/234/56789'],
		stays: ['Gasthaus Zur Linde', '37,30', 'Tagesgericht'],
		// The guest's company and the occasion are free text.
		knownGaps: ['Nordlicht AG', 'Projekt Polaris']
	},
	// Other languages (#366): the traveller's name, document and birth date go,
	// the stations, amounts and ticket numbers stay.
	'a Russian train ticket': {
		text: `Электронный билет № 7012345678901 · Железные дороги Пример
Пассажир: Иванова Мария Петровна
Паспорт: 45 12 345678 · Дата рождения: 01.02.1990
Москва Казанская 21:30 → Казань Пассажирская 07:45, поезд 002Й, вагон 5, место 17
Стоимость 4 512,30 руб., в т.ч. НДС 20 % 752,05 руб.
Телефон: +7 916 123-45-67`,
		hidden: ['Иванова', 'Мария', '45 12 345678', '01.02.1990', '123-45-67'],
		stays: ['Москва Казанская', 'Казань Пассажирская', '4 512,30', '752,05', '7012345678901'],
		knownGaps: []
	},
	'a Ukrainian bus ticket': {
		text: `Квиток № 0012345 · Автобуси Приклад
Пасажир: Коваленко Олена
Київ-Пасажирський 07:00 → Львів 12:30
Ціна 650,00 грн`,
		hidden: ['Коваленко', 'Олена'],
		stays: ['Київ-Пасажирський', 'Львів', '650,00', '0012345'],
		knownGaps: []
	},
	'a Turkish bus ticket': {
		text: `Otobüs Bileti · Örnek Turizm · PNR KX93TQ
Yolcu: Ayşe Yılmaz · Pasaport No: U12345678
Sayın Ayşe Yılmaz, iyi yolculuklar.
İstanbul Esenler 23:00 → Ankara AŞTİ 05:30, Koltuk 14
Tutar 850,00 TL (KDV dahil)
Cep: +90 532 123 45 67`,
		hidden: ['Ayşe', 'Yılmaz', 'U12345678', '123 45 67'],
		stays: ['İstanbul Esenler', 'Ankara AŞTİ', '850,00', 'KX93TQ'],
		knownGaps: []
	},
	'a Spanish boarding pass': {
		text: `Tarjeta de embarque / Boarding pass · Aerolínea Ejemplo
PASAJERO: GARCIA LOPEZ/JUAN MR
Vuelo XY1234 Madrid (MAD) → Berlín (BER) 12/03/2026 09:40
Localizador: QW7ERT · Billete 0751234567890
DNI 12345678Z
Total 189,40 EUR`,
		hidden: ['GARCIA', 'JUAN', '12345678Z'],
		stays: ['Madrid (MAD)', 'Berlín (BER)', 'QW7ERT', '0751234567890', '189,40', '12/03/2026'],
		knownGaps: []
	},
	'an Italian train ticket': {
		text: `Biglietto Treni Esempio · Codice PNR ABC123
Passeggero: Mario Rossi
Gentile Mario Rossi, buon viaggio.
Roma Termini 08:00 → Milano Centrale 11:10
Data di nascita: 03/04/1975
Importo 79,90 € IVA 10 % inclusa
Cellulare: 333 123 4567`,
		hidden: ['Mario', 'Rossi', '03/04/1975', '123 4567'],
		stays: ['Roma Termini', 'Milano Centrale', '79,90', 'ABC123'],
		knownGaps: []
	},
	'a Polish train ticket': {
		text: `Bilet · Koleje Przykład · Nr biletu 1234567
Pasażer: Anna Nowak
Kraków Główny 06:15 → Warszawa Centralna 08:40
Cena 149,00 zł (w tym VAT 8 %)`,
		hidden: ['Anna', 'Nowak'],
		stays: ['Kraków Główny', 'Warszawa Centralna', '149,00', '1234567'],
		knownGaps: []
	},
	'a French hotel invoice': {
		text: `Hôtel Exemple · Facture F-2026-0042
Client : Mme Claire Dupont
Voyageur : Claire Dupont
Arrivée 10/03/2026 · Départ 12/03/2026 · 2 nuits, petit-déjeuner inclus
Total 236,00 EUR dont TVA 10 % 21,45 EUR
Tél. : +33 1 23 45 67 89`,
		hidden: ['Claire', 'Dupont', '45 67 89'],
		stays: ['Hôtel Exemple', 'F-2026-0042', '236,00', '21,45', 'petit-déjeuner inclus'],
		knownGaps: []
	},
	'an Arabic hotel invoice': {
		text: `فندق المثال · فاتورة رقم 2026-118
الضيف: محمد أحمد
جواز السفر: P1234567
الوصول 10/03/2026 · المغادرة 12/03/2026 · ليلتان
المجموع 950,00 درهم شامل الضريبة 5 %
هاتف: +971 4 123 4567
شكرا لإقامتكم يا محمد`,
		hidden: ['أحمد', 'P1234567', '123 4567'],
		stays: ['فندق المثال', '2026-118', '950,00'],
		// A name in running text, without a label before it.
		knownGaps: ['يا محمد']
	},
	'an English airline e-ticket': {
		text: `E-TICKET RECEIPT · Example Air
PASSENGER NAME: BEISPIEL/LENA MS
TICKET NUMBER: 1234567890123 · BOOKING REF: ZX8K4P
XA 211 HAMBURG (HAM) - ISTANBUL (IST) 14MAR26 06:55
PASSPORT: C01X00T47 · DOB: 1985-05-14
FARE EUR 210.00 TAXES EUR 64.20 TOTAL EUR 274.20`,
		hidden: ['BEISPIEL', 'LENA', 'C01X00T47', '1985-05-14'],
		stays: ['HAMBURG (HAM)', 'ISTANBUL (IST)', '1234567890123', 'ZX8K4P', '274.20'],
		knownGaps: []
	}
};

for (const [name, doc] of Object.entries(DOCUMENTS)) {
	test(`scorecard, ${name}: what is hidden, what stays, what is known to get through`, () => {
		const { text } = redact(doc.text, options);
		for (const needle of doc.hidden) assert.ok(!text.includes(needle), `sent: ${needle}`);
		for (const needle of doc.stays) assert.ok(text.includes(needle), `lost: ${needle}`);
		for (const needle of doc.knownGaps) {
			assert.ok(text.includes(needle), `no longer sent, move to hidden: ${needle}`);
		}
	});
}

test('the scorecard’s count: how much of what a reader would call personal is hidden', () => {
	let hidden = 0;
	let gaps = 0;
	for (const doc of Object.values(DOCUMENTS)) {
		hidden += doc.hidden.length;
		gaps += doc.knownGaps.length;
	}
	// 68 of 78 marked places, nine documents in other languages among them (#366);
	// the ten that get through are named above.
	assert.deepEqual([hidden, gaps], [68, 10]);
});

test('the app’s company names are blacked out for the call they come with, and only for it', async () => {
	const text = 'Bill to: Beispiel GmbH, Lindenstraße 5';
	assert.ok(redact(text, options).text.includes('Beispiel GmbH'));
	const inside = await withExtraTerms(['Beispiel GmbH'], async () => {
		await new Promise((r) => setTimeout(r, 5));
		return redact(text, options).text;
	});
	assert.equal(inside.split(',')[0], 'Bill to: [FIRMA]');
	assert.ok(redact(text, options).text.includes('Beispiel GmbH'));
});

test('what the app may add: a few short strings, nothing else', () => {
	assert.deepEqual(cleanExtraTerms(['Beispiel GmbH', ' x ', 7, '', 'y'.repeat(81), 'Muster UG']), [
		'Beispiel GmbH',
		'Muster UG'
	]);
	assert.deepEqual(cleanExtraTerms('Beispiel GmbH'), []);
	assert.equal(cleanExtraTerms(Array.from({ length: 50 }, (_, i) => `Firma ${i}`)).length, 20);
});

test('labels without a name, and words that only look like one, are left alone', () => {
	const kept = [
		'Hallo zusammen, anbei die Rechnung.',
		'Kontakt: support@vendor.example',
		'Rechnung 2026 März, Abrechnung 2025 Dezember',
		'Betrag 1.234,56 EUR, Rechnungsnummer 0171-2026',
		'Tel. siehe Website',
		// Short salutations that are words too, a ticket that is no ID, an invoice that is no document (#366).
		'Pan Pacific Hotel, Bay Area, Don Quijote',
		'Fahrausweis Nr. 123456789',
		'Documento: F0011234567',
		'Казань Пассажирская 07:45'
	];
	for (const line of kept) {
		const out = redact(line, options).text;
		assert.equal(out.replace('[EMAIL @vendor.example]', 'support@vendor.example'), line, line);
	}
});
