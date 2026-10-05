// A mail without an attachment as the receipt's PDF in the monthly ZIP:
// sender, subject, day and the kept text are in it, long words and lines
// wrap, and a cut text says so. Every mail is made up.
import { describe, expect, it } from 'vitest';

import { isCut, mailReceiptPdf, readableMailText, wrap } from './mail-pdf.js';
import { extractPdfText } from '../receipts/pdf.js';

const mail = {
	id: 'R-MAIL',
	source: 'mail',
	from: 'Beispiel Cloud Inc. <billing@beispiel-cloud.example>',
	subject: 'Your receipt from Beispiel Cloud #2025-0042',
	receivedAt: '2025-01-14T09:30:00Z',
	excerpt:
		'Thanks for your payment.\n\nAmount paid: $25.00\nDate paid: Jan 14, 2025\nReceipt number 2025-0042'
};

describe('the PDF of a mail receipt', () => {
	it('holds sender, subject, day and the text, and says where it comes from', async () => {
		const bytes = await mailReceiptPdf(mail, {
			number: '2025-01-007',
			created: new Date('2025-02-01T10:00:00Z')
		});
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
		const { text } = await extractPdfText(bytes);
		for (const part of [
			'E-Mail-Beleg 2025-01-007',
			'billing@beispiel-cloud.example',
			'Your receipt from Beispiel Cloud #2025-0042',
			'14.01.2025',
			'Amount paid: $25.00',
			'Aus dem Text der E-Mail erzeugt'
		]) {
			expect(text).toContain(part);
		}
		expect(text).not.toContain('gekürzt');
	});

	it('a cut text says so', async () => {
		const long = `${'Zeile mit Text. '.repeat(130).slice(0, 1998)}…`;
		expect(isCut(long)).toBe(true);
		expect(isCut(mail.excerpt)).toBe(false);
		const bytes = await mailReceiptPdf(
			{ ...mail, excerpt: long },
			{ number: '2025-01-008', created: new Date() }
		);
		const { text, pages } = await extractPdfText(bytes);
		expect(text).toContain('Der gespeicherte Text ist gekürzt');
		expect(pages).toBeGreaterThanOrEqual(1);
	});

	it('wraps by width; a word longer than a line breaks', () => {
		const measure = (/** @type {string} */ s) => s.length;
		expect(wrap('eins zwei drei vier', measure, 9)).toEqual(['eins zwei', 'drei vier']);
		expect(wrap('abcdefghijkl', measure, 5)).toEqual(['abcde', 'fghij', 'kl']);
		expect(wrap('a\n\nb', measure, 5)).toEqual(['a', '', 'b']);
	});

	it('keeps the mail’s line breaks: no "?" where a line ended', async () => {
		const bytes = await mailReceiptPdf(
			{ ...mail, excerpt: 'Zeile eins\r\nZeile zwei\n\n\n\nZeile drei' },
			{ number: '2025-01-009', created: new Date() }
		);
		const { text } = await extractPdfText(bytes);
		expect(text).toContain('Zeile eins');
		expect(text).not.toMatch(/Zeile eins\s*\?\s*Zeile zwei/);
	});

	it('a receipt mail’s text: links shortened to their host, image references left out', () => {
		const text = [
			'-------- Ursprüngliche Nachricht --------',
			'Von: "Beispiel Cloud Inc." <invoice+statements@billing.example>',
			'',
			'Zahlungsbeleg von Beispiel Cloud Inc. 25,00 $',
			'Bezahlt am 14. Januar 2025 (Bild einer Rechnung [https://images.example/emails/invoice_illustration.png])',
			'Rechnung herunterladen (https://pay.billing.example/invoice/acct_0000/live_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/pdf?s=em)',
			'Fragen? hello@beispiel-cloud.example (https://beispiel.example)'
		].join('\r\n');
		expect(readableMailText(text).split('\n')).toEqual([
			'-------- Ursprüngliche Nachricht --------',
			'Von: "Beispiel Cloud Inc." <invoice+statements@billing.example>',
			'',
			'Zahlungsbeleg von Beispiel Cloud Inc. 25,00 $',
			'Bezahlt am 14. Januar 2025 (Bild einer Rechnung)',
			'Rechnung herunterladen (pay.billing.example/…)',
			'Fragen? hello@beispiel-cloud.example (https://beispiel.example)'
		]);
	});
});
