// The support diagnosis carries no data of the books. Made-up values only.
import { describe, expect, it } from 'vitest';

import { diagnosisText, scrubError } from './diagnosis.js';

describe('scrubError', () => {
	it('drops numbers, mail addresses, IBANs, hex, keys, URLs and quoted parts', () => {
		const out = scrubError(
			'Beleg „Wolkenfabrik Rechnung 10.pdf“ for buchhaltung@example.com, DE00 0000 0000 0000 0000 00, ' +
				'12,34 € on 01.02.2026, cid 0123456789abcdef0123, token abcdefghijklmnopqrstuvwxyzABCDEF12 at https://example.com/x?y=1'
		);
		expect(out).not.toMatch(
			/Wolkenfabrik|example\.com|DE00|12,34|2026|0123456789abcdef|abcdefghij/
		);
		expect(out).toContain('"…"');
		expect(out).toContain('<mail>');
		expect(out).toContain('<url>');
	});

	it('keeps the shape of a plain error and cuts it', () => {
		expect(scrubError('IndexedDB open timed out')).toBe('IndexedDB open timed out');
		expect(scrubError('ab '.repeat(400))).toHaveLength(300);
	});
});

describe('diagnosisText', () => {
	it('names version, step, error, browser and storage, and nothing else', () => {
		const text = diagnosisText({
			release: 'v0.34.0',
			commit: 'abc1234',
			status: 'starting',
			step: 'network',
			stepSeconds: 978.4,
			error: 'Failed for Stromwerk Test AG "Konto A" 99,00',
			userAgent: 'Mozilla/5.0 Test',
			language: 'de-DE',
			online: true,
			standalone: false,
			deviceSync: true,
			networkPaused: false,
			networkMode: 'public',
			storage: { usage: 52_000_000, quota: 10_000_000_000 },
			now: new Date('2026-11-16T08:00:00Z')
		});
		expect(text).toContain('version: v0.34.0 (abc1234)');
		expect(text).toContain('status: starting, step network for 978 s');
		expect(text).toContain('storage: 52 MB of 10000 MB');
		expect(text).not.toContain('Konto A');
		expect(text).not.toContain('99,00');
	});
});
