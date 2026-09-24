// Redaction and the answer checks, without a server.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { redact } from '../src/llm/redact.js';
import { checkExtraction, userMessage, MAX_TEXT } from '../src/llm/extract.js';

test('redact: terms, IBANs (last four kept), own e-mail, postcode, streets', () => {
	const input = [
		'Rechnung an Maria  Muster und Max Muster',
		'Lichtenberg 44',
		'12345 Beispielstadt',
		'Hauptstraße 5a, 54321 Anderort',
		'IBAN DE00 1234 5678 9012 3456 78',
		'Konto DE00123456789012345678',
		'Gläubiger-ID DE98ZZZ09999999999',
		'Kontakt: person@le-space.de, support@vendor.example'
	].join('\n');
	const { text, count } = redact(input, {
		terms: ['Maria Muster', 'Muster'],
		ownDomains: ['le-space.de']
	});
	assert.equal(
		text,
		[
			'Rechnung an [NAME] und Max [NAME]',
			'[STRASSE]',
			'[PLZ ORT]',
			'[STRASSE], [PLZ ORT]',
			'IBAN [IBAN …5678]',
			'Konto [IBAN …5678]',
			'Gläubiger-ID DE98ZZZ09999999999',
			'Kontakt: [EMAIL], support@vendor.example'
		].join('\n')
	);
	assert.equal(count, 9);
});

test('redact: no terms, no domains – still IBANs and addresses; regex characters in terms are literal', () => {
	const { text } = redact('A.B. (Test) DE00 0000 0000 0000 0000 01', { terms: ['A.B. (Test)'] });
	assert.equal(text, '[NAME] [IBAN …0001]');
	assert.equal(redact('AxB', { terms: ['A.B'] }).text, 'AxB');
});

test('checkExtraction: the answer must add up', () => {
	const ok = {
		gross: 119,
		net: 100,
		vat: [{ rate: 19, amount: 19 }],
		currency: 'EUR',
		invoice_date: '2026-08-15'
	};
	assert.deepEqual(checkExtraction(ok), []);
	assert.deepEqual(checkExtraction({ ...ok, net: 100.02 }), ['net + VAT is not gross']);
	assert.deepEqual(checkExtraction({ ...ok, net: 100.01 }), [], 'one cent of rounding is fine');
	assert.deepEqual(checkExtraction({ ...ok, net: null }), [], 'no net: nothing to add up');
	assert.deepEqual(checkExtraction({ ...ok, vat: [] }), [], 'no VAT lines: nothing to add up');
	assert.deepEqual(checkExtraction({ ...ok, gross: null }), ['gross missing']);
	assert.deepEqual(checkExtraction({ ...ok, currency: 'Euro' }), ['currency is not an ISO code']);
	assert.deepEqual(checkExtraction({ ...ok, invoice_date: '15.08.2026' }), [
		'invoice_date is not a date'
	]);
	assert.deepEqual(checkExtraction({ ...ok, due_or_debit_date: '2026-02-30' }), [
		'due_or_debit_date is not a date'
	]);
	assert.deepEqual(checkExtraction({ ...ok, service_period: { from: '2026-08-01', to: 'bald' } }), [
		'service_period is not two dates'
	]);
	assert.deepEqual(checkExtraction([]), ['not an object']);
	assert.deepEqual(
		checkExtraction({ ...ok, gross: -119, net: -100, vat: [{ rate: 19, amount: -19 }] }),
		[],
		'credit notes'
	);
});

test('userMessage: hints before the text, the text capped', () => {
	const m = userMessage('x'.repeat(MAX_TEXT + 100), { subject: 'Rechnung', from: 'a@b.example' });
	assert.ok(m.startsWith('Absender der E-Mail: a@b.example\nBetreff der E-Mail: Rechnung\n---\n'));
	assert.equal(
		m.length,
		'Absender der E-Mail: a@b.example\nBetreff der E-Mail: Rechnung\n---\n'.length + MAX_TEXT
	);
	assert.equal(userMessage('nur Text'), 'nur Text');
});
