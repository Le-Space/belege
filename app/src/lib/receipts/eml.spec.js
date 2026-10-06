import { describe, expect, it } from 'vitest';

import { emlText, htmlText } from './eml.js';

const enc = (/** @type {string} */ s) => new TextEncoder().encode(s);
const latin1 = (/** @type {string} */ s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Made-up mails; every shop and amount invented. */
describe('the text of a kept mail (#288)', () => {
	it('a plain mail, its text as written', () => {
		const eml = enc(
			'From: shop@beispiel.example\r\nSubject: Ihre Bestellung\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nDanke für Ihre Bestellung.\r\nSumme: 23,80 EUR\r\n'
		);
		expect(emlText(eml)).toBe('Danke für Ihre Bestellung.\nSumme: 23,80 EUR');
	});

	it('multipart/alternative: the plain text, not the HTML', () => {
		const eml = enc(
			[
				'Subject: Quittung',
				'Content-Type: multipart/alternative; boundary="b1"',
				'',
				'--b1',
				'Content-Type: text/plain; charset=utf-8',
				'Content-Transfer-Encoding: quoted-printable',
				'',
				'Summe: 12,00 EUR =E2=80=93 bezahlt mit Karte, und dieser Satz ist so lang, dass er=',
				' umbrochen wurde.',
				'--b1',
				'Content-Type: text/html',
				'',
				'<p>HTML</p>',
				'--b1--',
				''
			].join('\r\n')
		);
		expect(emlText(eml)).toBe(
			'Summe: 12,00 EUR – bezahlt mit Karte, und dieser Satz ist so lang, dass er umbrochen wurde.'
		);
	});

	it('only HTML, base64, inside a mixed mail with an attachment: its text, scripts and styles gone', () => {
		const html =
			'<html><head><style>p{color:red}</style></head><body><p>Danke f&uuml;r Ihren Einkauf bei <b>Papier Beispiel</b>.</p><p>Summe:&nbsp;23,80&nbsp;&euro;</p><script>alert(1)</script><img src="https://tracker.example/x.png"></body></html>';
		const eml = enc(
			[
				'Content-Type: multipart/mixed; boundary=outer',
				'',
				'--outer',
				'Content-Type: text/html; charset=utf-8',
				'Content-Transfer-Encoding: base64',
				'',
				btoa(html),
				'--outer',
				'Content-Type: text/plain; name="agb.txt"',
				'Content-Disposition: attachment; filename="agb.txt"',
				'',
				'Allgemeine Geschäftsbedingungen',
				'--outer--'
			].join('\r\n')
		);
		const text = emlText(eml);
		expect(text).toBe('Danke für Ihren Einkauf bei Papier Beispiel.\nSumme: 23,80 €');
		expect(text).not.toContain('alert');
		expect(text).not.toContain('tracker');
	});

	it('a charset other than UTF-8', () => {
		const eml = latin1('Content-Type: text/plain; charset=iso-8859-1\r\n\r\nGrüße aus München\r\n');
		expect(emlText(eml)).toBe('Grüße aus München');
	});

	it('no text part: nothing', () => {
		expect(emlText(enc('Content-Type: image/png\r\n\r\n\u0089PNG'))).toBe('');
		expect(emlText(new Uint8Array())).toBe('');
	});

	it('HTML as text: blocks as lines, entities decoded', () => {
		expect(htmlText('<div>Zeile 1</div><div>Zeile&#32;2 &amp; mehr</div>')).toBe(
			'Zeile 1\nZeile 2 & mehr'
		);
	});
});
