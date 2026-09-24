// A fake mail server for tests: hoodiecrow (a scriptable IMAP server in
// memory) on 127.0.0.1, without TLS, with a synthetic mailbox that mixes
// receipts to the accounting alias with private mail – the situation the
// phase-0 probe found (docs/phase-0.md).
//
// Everything here is made up: vendors, people, addresses, IBANs (check digits
// 00). The PDFs are generated (synthetic-pdf.js).

import { createRequire } from 'node:module';

import { makePdf, TINY_JPEG, TINY_PNG } from './synthetic-pdf.js';

const require = createRequire(import.meta.url);
const hoodiecrow = require('hoodiecrow-imap');

export const FAKE_IMAP_USER = 'person@le-space.de';
export const FAKE_IMAP_PASSWORD = 'fake-imap-token-for-tests';
export const ACCOUNTING = 'buchhaltung@le-space.de';
export const PERSONAL = 'person@le-space.de';

/** Made-up personal data the redaction must black out before the LLM sees it. */
export const SECRETS = {
	customerName: 'Erika Beispielkund',
	iban: 'DE00 1111 2222 3333 4444 55',
	street: 'Lindenhof 44',
	postcode: '12345 Beispielstadt',
	ownMail: 'person@le-space.de'
};

/** Markers of what each receipt says, for assertions. */
export const RECEIPTS = {
	wolkenfabrik: {
		vendor: 'Wolkenfabrik Hosting GmbH',
		invoice: 'WF-2026-0815',
		gross: '119,00',
		marker: 'MARKER-WOLKE-7F3A'
	},
	stromwerk: {
		vendor: 'Stromwerk Test AG',
		invoice: 'SW-4711',
		gross: '52,59',
		marker: 'MARKER-STROM-19C2'
	},
	papierladen: { vendor: 'Papierladen Test KG', gross: '23,80' },
	phishing: { vendor: 'PayPaI Abrechnung', marker: 'MARKER-PHISH-0000' },
	buero: { vendor: 'Buerobedarf Muster OHG', gross: '35,70', marker: 'MARKER-BUERO-55AA' }
};

/**
 * The text of a synthetic invoice: labelled lines a fake LLM can read back,
 * and the personal data a real one would find on it.
 *
 * @param {{ vendor: string, invoice: string, date: string, net: string, vat: string, gross: string, marker: string }} r
 */
export function invoiceLines(r) {
	return [
		`Anbieter: ${r.vendor}`,
		`Rechnungsnummer: ${r.invoice}`,
		`Rechnungsdatum: ${r.date}`,
		`Netto: ${r.net} EUR`,
		`USt 19%: ${r.vat} EUR`,
		`Brutto: ${r.gross} EUR`,
		`Kennung: ${r.marker}`,
		'',
		'Rechnungsempfaenger:',
		SECRETS.customerName,
		SECRETS.street,
		SECRETS.postcode,
		`Abbuchung von IBAN ${SECRETS.iban}`,
		`Fragen an ${SECRETS.ownMail}`
	];
}

/** Non-ASCII headers as RFC 2047 encoded words, as real mail sends them. */
const encodeWord = (/** @type {string} */ s) =>
	/^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;

/** @param {Date} d */
const rfc2822 = (d) => d.toUTCString().replace('GMT', '+0000');
/** @param {Date} d */
function internalDate(d) {
	const months = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];
	const p = (/** @type {number} */ n) => String(n).padStart(2, '0');
	return `${p(d.getUTCDate())}-${months[d.getUTCMonth()]}-${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00 +0000`;
}
/** @param {Date} d */
export const isoDay = (d) => d.toISOString().slice(0, 10);

/**
 * @param {object} m
 * @param {string} m.from
 * @param {string} m.to
 * @param {string} m.subject
 * @param {Date} m.date
 * @param {string[]} [m.headers] extra header lines, topmost first
 * @param {string} [m.text]
 * @param {string} [m.html]
 * @param {{ name: string, type: string, bytes: Buffer, disposition?: string, cid?: string }[]} [m.attachments]
 */
export function mime({ from, to, subject, date, headers = [], text, html, attachments = [] }) {
	const b = `b-${Math.random().toString(36).slice(2)}`;
	const lines = [
		...headers,
		`From: ${from}`,
		`To: ${to}`,
		`Subject: ${encodeWord(subject)}`,
		`Date: ${rfc2822(date)}`,
		`Message-ID: <${Math.random().toString(36).slice(2)}@test.example>`,
		'MIME-Version: 1.0',
		`Content-Type: multipart/mixed; boundary="${b}"`,
		''
	];
	if (text !== undefined) {
		lines.push(
			`--${b}`,
			'Content-Type: text/plain; charset=utf-8',
			'Content-Transfer-Encoding: 8bit',
			'',
			text
		);
	}
	if (html !== undefined) {
		lines.push(
			`--${b}`,
			'Content-Type: text/html; charset=utf-8',
			'Content-Transfer-Encoding: 8bit',
			'',
			html
		);
	}
	for (const a of attachments) {
		const base64 = a.bytes.toString('base64').replace(/.{76}/g, '$&\r\n');
		lines.push(
			`--${b}`,
			`Content-Type: ${a.type}; name="${a.name}"`,
			`Content-Disposition: ${a.disposition ?? 'attachment'}; filename="${a.name}"`,
			...(a.cid ? [`Content-ID: <${a.cid}>`] : []),
			'Content-Transfer-Encoding: base64',
			'',
			base64
		);
	}
	lines.push(`--${b}--`, '');
	return lines.join('\r\n');
}

/** @param {string} to @param {Date} date */
const received = (to, date) =>
	`Received: from mx.test.example by mail.le-space.de with LMTP id abc\r\n\tfor <${to}>; ${rfc2822(date)}`;
/** @param {string} domain @param {'pass' | 'fail'} result */
const authResults = (domain, result = 'pass') =>
	result === 'pass'
		? `Authentication-Results: mail.le-space.de; dkim=pass header.d=${domain} header.s=s1; spf=pass (sender ok) smtp.mailfrom=bounce@${domain}; dmarc=pass header.from=${domain}`
		: `Authentication-Results: mail.le-space.de; dkim=fail (bad signature) header.d=${domain}; spf=softfail smtp.mailfrom=${domain}; dmarc=fail header.from=${domain}`;

/**
 * A mailbox as the phase-0 probe found it, around `base` (default: three days
 * ago, so a default "this month and the last" window always holds the
 * receipts).
 *
 * @param {{ base?: Date }} [options]
 */
export function sampleMailbox({ base = new Date(Date.now() - 3 * 864e5) } = {}) {
	const day = (/** @type {number} */ offset) => new Date(base.getTime() - offset * 864e5);
	const w = RECEIPTS.wolkenfabrik;
	const s = RECEIPTS.stromwerk;
	const bu = RECEIPTS.buero;
	const pdfW = makePdf(
		invoiceLines({ ...w, date: isoDay(day(1)), net: '100,00', vat: '19,00', gross: w.gross })
	);
	const pdfS = makePdf(
		invoiceLines({ ...s, date: isoDay(day(2)), net: '44,19', vat: '8,40', gross: s.gross })
	);
	const pdfB = makePdf(
		invoiceLines({
			vendor: bu.vendor,
			invoice: 'BM-77',
			date: isoDay(day(3)),
			net: '30,00',
			vat: '5,70',
			gross: bu.gross,
			marker: bu.marker
		})
	);
	const pdfPhish = makePdf([
		`Anbieter: ${RECEIPTS.phishing.vendor}`,
		'Konto gesperrt',
		RECEIPTS.phishing.marker
	]);
	const pdfPrivate = makePdf(['Privat', 'Urlaubsplanung Beispiel']);

	/** @param {Date} d @param {string} raw */
	const msg = (d, raw) => ({ raw, internaldate: internalDate(d) });

	const inbox = [
		// 1. To: the alias, DKIM pass, a real application/pdf.
		msg(
			day(1),
			mime({
				headers: [authResults('wolkenfabrik.example'), received(ACCOUNTING, day(1))],
				from: `"${w.vendor}" <rechnung@wolkenfabrik.example>`,
				to: ACCOUNTING,
				subject: `Ihre Rechnung ${w.invoice}`,
				date: day(1),
				text: 'Guten Tag,\nim Anhang finden Sie Ihre Rechnung.\nViele Gruesse',
				attachments: [{ name: `Rechnung-${w.invoice}.pdf`, type: 'application/pdf', bytes: pdfW }]
			})
		),
		// 2. Bcc to the alias: To: is the personal address, only Received says "for <alias>";
		//    the PDF comes as application/octet-stream with an upper-case .PDF.
		msg(
			day(2),
			mime({
				headers: [authResults('stromwerk.example'), received(ACCOUNTING, day(2))],
				from: `"${s.vendor}" <kundenservice@stromwerk.example>`,
				to: PERSONAL,
				subject: 'Rechnung zu Ihrem Vertrag',
				date: day(2),
				text: `Ihre Rechnung ueber ${s.gross} EUR liegt bei.`,
				attachments: [{ name: 'RECHNUNG.PDF', type: 'application/octet-stream', bytes: pdfS }]
			})
		),
		// 3. Private mail to the personal address: never in the accounting scope.
		msg(
			day(2),
			mime({
				headers: [authResults('freunde.example'), received(PERSONAL, day(2))],
				from: '"Freundin Privat" <freundin@freunde.example>',
				to: PERSONAL,
				subject: 'Urlaub Privatgeheimnis',
				date: day(2),
				text: 'Hallo, anbei die Planung. Kostet 52,59 pro Person.',
				attachments: [{ name: 'Planung.pdf', type: 'application/pdf', bytes: pdfPrivate }]
			})
		),
		// 4. Phishing look-alike to the alias: DKIM/SPF/DMARC fail.
		msg(
			day(3),
			mime({
				headers: [authResults('paypa1-billing.example', 'fail'), received(ACCOUNTING, day(3))],
				from: `"${RECEIPTS.phishing.vendor}" <service@paypa1-billing.example>`,
				to: ACCOUNTING,
				subject: 'Zahlung fehlgeschlagen – Zahlungsmethode aktualisieren',
				date: day(3),
				text: 'Ihr Konto wurde eingeschraenkt. Details im Anhang.',
				attachments: [{ name: 'Rechnung.pdf', type: 'application/pdf', bytes: pdfPhish }]
			})
		),
		// 5. No attachment, HTML only: an order confirmation to the alias.
		msg(
			day(4),
			mime({
				headers: [authResults('papierladen.example'), received(ACCOUNTING, day(4))],
				from: `"${RECEIPTS.papierladen.vendor}" <shop@papierladen.example>`,
				to: ACCOUNTING,
				subject: 'Ihre Bestellung 2026-555',
				date: day(4),
				html: `<html><head><style>p{color:red}</style></head><body><p>Danke f&uuml;r Ihre Bestellung bei <b>${RECEIPTS.papierladen.vendor}</b>.</p><p>Summe: ${RECEIPTS.papierladen.gross}&nbsp;EUR</p><script>alert(1)</script></body></html>`
			})
		),
		// 6. A photo of a taxi receipt (JPEG attachment) next to an inline logo.
		msg(
			day(5),
			mime({
				headers: [authResults('taxi.example'), received(ACCOUNTING, day(5))],
				from: '"Taxi Muster" <quittung@taxi.example>',
				to: ACCOUNTING,
				subject: 'Ihre Taxiquittung',
				date: day(5),
				html: '<p>Quittung anbei.</p><img src="cid:logo1">',
				attachments: [
					{
						name: 'logo.png',
						type: 'image/png',
						bytes: TINY_PNG,
						disposition: 'inline',
						cid: 'logo1'
					},
					{ name: 'quittung.jpg', type: 'image/jpeg', bytes: TINY_JPEG }
				]
			})
		),
		// 7. To the alias, but long before the window.
		msg(
			day(70),
			mime({
				headers: [authResults('alt.example'), received(ACCOUNTING, day(70))],
				from: '"Altlieferant" <rechnung@alt.example>',
				to: ACCOUNTING,
				subject: 'Alte Rechnung',
				date: day(70),
				text: 'Alt.'
			})
		),
		// 8. A newsletter that mentions the vendor: text search hit, not a receipt.
		msg(
			day(2),
			mime({
				headers: [authResults('news.example'), received(PERSONAL, day(2))],
				from: '"Energie-News" <news@news.example>',
				to: PERSONAL,
				subject: 'Neues von Stromwerk und anderen',
				date: day(2),
				text: 'Stromwerk senkt die Preise.'
			})
		)
	];

	const sent = [
		// 9. A receipt we forwarded from our own address to the alias: no Authentication-Results.
		msg(
			day(3),
			mime({
				from: `"Person" <${PERSONAL}>`,
				to: ACCOUNTING,
				subject: 'Fwd: Beleg Buerobedarf',
				date: day(3),
				text: 'Zur Ablage.',
				attachments: [{ name: 'Beleg-Buero.pdf', type: 'application/pdf', bytes: pdfB }]
			})
		)
	];

	const trash = [
		msg(
			day(1),
			mime({
				headers: [authResults('geloescht.example'), received(ACCOUNTING, day(1))],
				from: '"Geloescht" <rechnung@geloescht.example>',
				to: ACCOUNTING,
				subject: 'Im Papierkorb Geloescht',
				date: day(1),
				text: 'weg'
			})
		)
	];
	const junk = [
		msg(
			day(1),
			mime({
				headers: [received(ACCOUNTING, day(1))],
				from: '"Spam" <spam@spam.example>',
				to: ACCOUNTING,
				subject: 'Spamrechnung Junkordner 52,59',
				date: day(1),
				text: 'Gewinnspiel 52,59'
			})
		)
	];

	return {
		INBOX: { messages: inbox },
		'': {
			separator: '/',
			folders: {
				Sent: { 'special-use': '\\Sent', messages: sent },
				Trash: { 'special-use': '\\Trash', messages: trash },
				Junk: { 'special-use': '\\Junk', messages: junk },
				Drafts: { 'special-use': '\\Drafts', messages: [] }
			}
		}
	};
}

/**
 * @param {{ storage?: any }} [options]
 * @returns {Promise<{ host: string, port: number, user: string, close: () => Promise<void> }>}
 */
export async function startFakeImap({ storage = sampleMailbox() } = {}) {
	const server = hoodiecrow({
		plugins: ['ID', 'SPECIAL-USE', 'ENABLE', 'UNSELECT', 'NAMESPACE'],
		users: { [FAKE_IMAP_USER]: { password: FAKE_IMAP_PASSWORD } },
		storage
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.server.address()).port;
	return {
		host: '127.0.0.1',
		port,
		user: FAKE_IMAP_USER,
		close: () =>
			new Promise((resolve) => {
				server.server.close(() => resolve(undefined));
				// Open client sockets would keep close() waiting.
				for (const s of server.connectionHandlers ?? []) s?.destroy?.();
				setTimeout(() => resolve(undefined), 200);
			})
	};
}
