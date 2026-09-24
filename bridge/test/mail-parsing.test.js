// The pure mail helpers: Authentication-Results, MIME parts, sniffing, ids,
// amounts, windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { authVerdict, headerValues, parseAuthenticationResults } from '../src/mail/auth-results.js';
import {
	amountVariants,
	attachmentParts,
	decodeMailId,
	encodeMailId,
	excerpt,
	htmlToText,
	isIsoDay,
	isPartNumber,
	searchWindow,
	sniff,
	textPart
} from '../src/mail/mime.js';
import { makePdf, TINY_JPEG, TINY_PNG } from './support/synthetic-pdf.js';

/** @param {string} ar @param {string} [extra] */
const headers = (ar, extra = '') => `${extra}Authentication-Results: ${ar}\r\n`;

test('Authentication-Results: aligned DKIM pass, SPF pass, DMARC pass', () => {
	const h = headers(
		'mx.le-space.de; dkim=pass (2048-bit key) header.d=vendor.example header.s=k1;\r\n\tspf=pass smtp.mailfrom=bounce@mail.vendor.example; dmarc=pass header.from=vendor.example'
	);
	assert.deepEqual(authVerdict({ headers: h, from: 'billing@vendor.example' }), {
		verdict: 'pass',
		dkim: 'pass',
		spf: 'pass',
		dmarc: 'pass',
		domain: 'vendor.example'
	});
});

test('Authentication-Results: a look-alike fails; a pass for another domain only is no pass', () => {
	const phish = headers(
		'mx.le-space.de; dkim=fail header.d=paypa1.example; spf=softfail smtp.mailfrom=paypa1.example; dmarc=fail'
	);
	assert.equal(authVerdict({ headers: phish, from: 'service@paypa1.example' }).verdict, 'fail');
	const foreign = headers(
		'mx.le-space.de; dkim=pass header.d=mailer.example; spf=pass smtp.mailfrom=bounces@mailer.example'
	);
	assert.equal(authVerdict({ headers: foreign, from: 'invoice@vendor.example' }).verdict, 'none');
	// DMARC fail wins over an aligned DKIM pass.
	const dmarcFail = headers('mx; dkim=pass header.d=vendor.example; dmarc=fail');
	assert.equal(authVerdict({ headers: dmarcFail, from: 'a@vendor.example' }).verdict, 'fail');
});

test('Authentication-Results: none at all is none; a forged lower header does not count', () => {
	assert.equal(authVerdict({ headers: '', from: 'a@vendor.example' }).verdict, 'none');
	// The sender put a "pass" in; our server's own (topmost) says fail.
	const h =
		headers(
			'mx.le-space.de; dkim=fail header.d=vendor.example; spf=fail smtp.mailfrom=vendor.example'
		) + headers('forged.example; dkim=pass header.d=vendor.example; dmarc=pass');
	assert.equal(authVerdict({ headers: h, from: 'a@vendor.example' }).verdict, 'fail');
	// With authServId, only that server's headers count, wherever they are.
	const lower =
		headers('forged.example; dkim=pass header.d=vendor.example; dmarc=pass') +
		headers('mx.le-space.de; dkim=pass header.d=vendor.example');
	assert.equal(
		authVerdict({ headers: lower, from: 'a@vendor.example', authServId: 'mx.le-space.de' }).dmarc,
		null
	);
	assert.equal(
		authVerdict({ headers: lower, from: 'a@vendor.example', authServId: 'mx.le-space.de' }).verdict,
		'pass'
	);
});

test('headerValues unfolds; parseAuthenticationResults ignores comments', () => {
	assert.deepEqual(headerValues('A: 1\r\nB: two\r\n  lines\r\nb: 3\r\n', 'b'), ['two lines', '3']);
	const { servId, results } = parseAuthenticationResults(
		'MX.Example (comment; with semicolon); spf=pass (ok) smtp.mailfrom=x@y.example'
	);
	assert.equal(servId, 'mx.example');
	assert.deepEqual(results, [
		{ method: 'spf', result: 'pass', props: { 'smtp.mailfrom': 'x@y.example' } }
	]);
});

test('attachmentParts: named and attachment parts; which are worth a look', () => {
	const structure = {
		type: 'multipart/mixed',
		childNodes: [
			{ part: '1', type: 'text/plain' },
			{
				part: '2',
				type: 'application/octet-stream',
				parameters: { name: 'R.PDF' },
				disposition: 'attachment',
				size: 10
			},
			{
				part: '3',
				type: 'image/png',
				disposition: 'inline',
				dispositionParameters: { filename: 'logo.png' }
			},
			{
				part: '4',
				type: 'image/jpeg',
				disposition: 'attachment',
				dispositionParameters: { filename: 'beleg.jpg' }
			},
			{
				part: '5',
				type: 'text/calendar',
				disposition: 'attachment',
				dispositionParameters: { filename: 'reise.ics' }
			}
		]
	};
	assert.deepEqual(
		attachmentParts(structure).map((p) => [p.part, p.name, p.candidate]),
		[
			['2', 'R.PDF', true],
			['3', 'logo.png', false],
			['4', 'beleg.jpg', true],
			['5', 'reise.ics', false]
		]
	);
	assert.deepEqual(textPart(structure), { part: '1', html: false });
	assert.deepEqual(
		textPart({ type: 'multipart/alternative', childNodes: [{ part: '1', type: 'text/html' }] }),
		{ part: '1', html: true }
	);
	assert.equal(textPart({ type: 'image/png', disposition: 'attachment' }), null);
});

test('sniff: PDFs and images by their bytes, anything else is other', () => {
	assert.deepEqual(sniff(makePdf(['x'])), { kind: 'pdf', mime: 'application/pdf' });
	assert.equal(sniff(Buffer.concat([Buffer.from('\r\n  '), makePdf(['x'])])).kind, 'pdf');
	assert.deepEqual(sniff(TINY_PNG), { kind: 'image', mime: 'image/png' });
	assert.deepEqual(sniff(TINY_JPEG), { kind: 'image', mime: 'image/jpeg' });
	assert.equal(sniff(Buffer.from('PK\x03\x04 a zip')).kind, 'other');
	assert.equal(sniff(Buffer.from('BEGIN:VCALENDAR')).kind, 'other');
	assert.equal(sniff(new Uint8Array()).kind, 'other');
});

test('htmlToText and excerpt: no markup, no scripts, entities, at most 2000 characters', () => {
	const text = htmlToText(
		'<style>.a{}</style><p>Gr&uuml;&szlig;e &amp; Dank</p><script>x()</script><div>Summe:&nbsp;12,00&euro;</div>&#8364;'
	);
	assert.equal(excerpt(text), 'Grüße & Dank\nSumme: 12,00€\n€');
	const long = excerpt('a'.repeat(5000));
	assert.equal(long.length, 2000);
	assert.ok(long.endsWith('…'));
});

test('mail ids: round trip, and nothing else decodes', () => {
	const id = encodeMailId({ folder: 'INBOX/Rechnungen', uidValidity: 1234567890n, uid: 42 });
	assert.deepEqual(decodeMailId(id), {
		folder: 'INBOX/Rechnungen',
		uidValidity: '1234567890',
		uid: 42
	});
	for (const bad of [
		'',
		'short',
		'../../etc',
		Buffer.from('[1,2,3]').toString('base64url'),
		Buffer.from('["INBOX","1",-1]').toString('base64url')
	]) {
		assert.equal(decodeMailId(bad), null, bad);
	}
	assert.ok(isPartNumber('2') && isPartNumber('1.2.3'));
	assert.ok(!isPartNumber('1;') && !isPartNumber('') && !isPartNumber('TEXT'));
});

test('amountVariants: every spelling a mail may use', () => {
	assert.deepEqual(amountVariants('52,59'), ['52,59', '52.59']);
	assert.deepEqual(amountVariants('1.190,00'), ['1190,00', '1190.00', '1.190,00', '1,190.00']);
	assert.deepEqual(amountVariants('1,190.00'), ['1190,00', '1190.00', '1.190,00', '1,190.00']);
	assert.deepEqual(amountVariants('7'), ['7,00', '7.00']);
	assert.deepEqual(amountVariants('abc'), []);
});

test('searchWindow leaves the end open when it reaches into the future (Dovecot rejects OLDER 0)', () => {
	const now = new Date('2026-09-24T12:00:00Z');
	const since = new Date('2026-08-01T00:00:00Z');
	assert.deepEqual(searchWindow(since, new Date('2026-09-01T00:00:00Z'), now), {
		since,
		before: new Date('2026-09-01T00:00:00Z')
	});
	assert.deepEqual(searchWindow(since, new Date('2026-10-01T00:00:00Z'), now), { since });
	assert.deepEqual(searchWindow(since, null, now), { since });
	assert.ok(isIsoDay('2026-02-28') && !isIsoDay('2026-02-30') && !isIsoDay('2026-2-1'));
});
