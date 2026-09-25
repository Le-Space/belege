// How a receipt was read, from the bridge's answer onto the record and into words.
import { describe, expect, it } from 'vitest';

import { extractionInfo } from './extract.js';
import { attemptReasonText, extractionHow } from './how.js';

const ANSWER = {
	extraction: { vendor: 'X', gross: 1 },
	model: 'deepseek-v4-pro',
	usage: { prompt: 500, completion: 312, reasoning: 200 },
	ms: 1400,
	attempts: [
		{
			model: 'deepseek-flash',
			ok: false,
			reason: 'stopped early: length',
			ms: 600,
			usage: { prompt: 500, completion: 6000, reasoning: 5900 }
		},
		{
			model: 'deepseek-v4-pro',
			ok: true,
			reason: 'ok',
			ms: 800,
			usage: { prompt: 500, completion: 312, reasoning: 200 }
		}
	],
	fallback: { used: true, reason: 'stopped early: length' },
	redactions: { terms: 2, iban: 1, email: 1, street: 2, postcode: 1, total: 7 },
	sentText: '[NAME] …'
};

describe('extractionInfo', () => {
	it('keeps model, fallback and why, duration, tokens of every attempt, redactions by kind', () => {
		expect(extractionInfo(ANSWER)).toEqual({
			model: 'deepseek-v4-pro',
			fallback: true,
			fallbackReason: 'stopped early: length',
			attempts: [
				{ model: 'deepseek-flash', ok: false, reason: 'stopped early: length', ms: 600 },
				{ model: 'deepseek-v4-pro', ok: true, reason: 'ok', ms: 800 }
			],
			ms: 1400,
			usage: { prompt: 500, completion: 312, reasoning: 200 },
			tokensTotal: 7312,
			redactions: { terms: 2, iban: 1, email: 1, street: 2, postcode: 1, link: 0, total: 7 }
		});
	});

	it('an older bridge (a count only, no timing): zeros and nulls, never undefined', () => {
		const info = extractionInfo({
			model: 'deepseek-flash',
			usage: {},
			attempts: [{}],
			redactions: 5
		});
		expect(info).toMatchObject({
			fallback: false,
			fallbackReason: null,
			ms: null,
			redactions: { total: 5 }
		});
		expect(JSON.stringify(info)).not.toContain('undefined');
		expect(Object.values(info).includes(undefined)).toBe(false);
	});
});

describe('extractionHow', () => {
	it('the line under the receipt, and the second attempt in German', () => {
		const how = extractionHow({
			extraction: {},
			extractionModel: 'deepseek-v4-pro',
			extractionInfo: extractionInfo(ANSWER)
		});
		expect(how?.line).toBe(
			'Ausgelesen mit deepseek-v4-pro · 1,4 s · 7.312 Tokens · 7 Stellen geschwärzt'
		);
		expect(how?.fallback).toBe(
			'zweiter Versuch mit deepseek-v4-pro, weil die Antwort abbrach (Token-Grenze erreicht)'
		);
		expect(how?.redactions).toBe(
			'Geschwärzt: 2 Namen, 1 IBANs, 1 E-Mail-Adressen, 2 Straßen, 1 PLZ und Ort, 0 Links'
		);
	});

	it('read before this was kept: the model only; not read: nothing', () => {
		expect(extractionHow({ extraction: {}, extractionModel: 'deepseek-flash' })?.line).toBe(
			'Ausgelesen mit deepseek-flash'
		);
		expect(extractionHow({ extraction: null })).toBeNull();
	});

	it('reasons', () => {
		expect(attemptReasonText('checks failed: net + VAT is not gross')).toBe(
			'die Antwort nicht aufging (net + VAT is not gross)'
		);
		expect(attemptReasonText('HTTP 500')).toBe('der Dienst einen Fehler meldete (HTTP 500)');
		expect(attemptReasonText('unreachable: timeout')).toBe('der Dienst nicht erreichbar war');
		expect(attemptReasonText('content is not JSON')).toBe('die Antwort kein JSON war');
	});
});
