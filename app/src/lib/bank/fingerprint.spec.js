import { describe, expect, it } from 'vitest';

import { fingerprint, ibanKey } from './fingerprint.js';

describe('fingerprint', () => {
	it('is the same value the bridge computes (bridge/test/normalize.test.js)', async () => {
		const fp = await fingerprint({
			account: 'hibiscus:1',
			date: '2026-09-22',
			amountCents: -2242,
			purpose: 'Rechnung  KR-1\n',
			counterpartyName: 'Nordlicht GmbH'
		});
		expect(fp).toBe('fp1:e545ee3e0b85df5ad59544b178f42faef35bbaa5ff49500e706ce726506a2396');
	});

	it('an IBAN key does not contain the IBAN, and ignores spacing', async () => {
		const key = await ibanKey('LT00 0000 0000 0000 0001');
		expect(key).toMatch(/^iban-sha256:[0-9a-f]{64}$/);
		expect(key).toBe(await ibanKey('lt000000000000000001'));
		expect(key.toUpperCase()).not.toContain('LT00');
	});
});
