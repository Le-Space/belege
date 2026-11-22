import { afterEach, describe, expect, it, vi } from 'vitest';

import { setLocale } from '../i18n/index.js';
import { logTime, logWhat } from './log-text.js';

/** @type {import('./sync-log.js').SyncLine} */
const line = {
	at: Date.parse('2026-03-01T10:00:00.000Z'),
	direction: 'in',
	collection: 'transactions',
	peerId: null,
	op: 'new',
	id: 'x',
	what: { counterparty: 'Wolkenfabrik Hosting GmbH', amountCents: -1234, date: '2026-03-01' }
};

describe('the devices log, as the card shows it', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		setLocale('de');
	});

	it('says what a line is about, in the app language', () => {
		setLocale('de');
		expect(logWhat(line)).toBe('Wolkenfabrik Hosting GmbH · -12,34 € · 2026-03-01');
		expect(logWhat({ ...line, what: { fileName: 'beleg.pdf', size: 20480 } })).toBe(
			'beleg.pdf · 20 kB'
		);
		setLocale('en');
		expect(logWhat(line)).toBe('Wolkenfabrik Hosting GmbH · -€12.34 · 2026-03-01');
		expect(logTime(line.at)).toMatch(/^01\/03\/2026/);
	});

	it('makes its formatters once per language, not once per line', () => {
		setLocale('de');
		logTime(line.at);
		logWhat(line);
		logWhat({ ...line, what: { size: 1024 } });
		const dates = vi.spyOn(Intl, 'DateTimeFormat');
		const numbers = vi.spyOn(Intl, 'NumberFormat');
		for (let i = 0; i < 100; i++) {
			logTime(line.at + i);
			logWhat({ ...line, what: { ...line.what, size: i * 1024 } });
		}
		expect(dates).not.toHaveBeenCalled();
		expect(numbers).not.toHaveBeenCalled();
	});
});
