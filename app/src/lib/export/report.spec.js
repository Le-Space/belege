import { describe, expect, it } from 'vitest';
import { REPORT_ADDRESS, reportMail, reportMailto } from './report.js';

const rec = (/** @type {Record<string, unknown>} */ r) => r;
const plan = {
	lines: [
		{
			line: {},
			tx: rec({
				counterparty: 'Wolkenfabrik Hosting GmbH',
				amountCents: -1234,
				purpose: 'Rechnung 4711'
			})
		},
		{ line: {}, tx: rec({ counterparty: 'Stromwerk Test AG', amountCents: -5678 }) }
	],
	checks: {
		unassigned: [],
		noLedger: [],
		noBankAccount: [],
		missingReceipt: [rec({ counterparty: 'Stromwerk Test AG', amountCents: -5678 })],
		unlinkedReceipts: [rec({ vendor: 'Wolkenfabrik Hosting GmbH' })],
		copies: [],
		unverified: [],
		unpriced: [],
		suspense: []
	}
};

describe('"Fehler melden" (#1053)', () => {
	it('fills in the month, the app and the counts', () => {
		const { subject, body } = reportMail({
			month: '2026-10',
			app: 'v0.64.0',
			plan: /** @type {any} */ (plan)
		});
		expect(subject).toContain('2026-10');
		expect(body).toContain('Monat: 2026-10');
		expect(body).toContain('App-Version: v0.64.0');
		expect(body).toContain('Buchungen: 2');
		expect(body).toContain('1 ohne Beleg');
		expect(body).toContain('1 Belege übrig');
	});

	it('never an amount, a name or a purpose', () => {
		const href = decodeURIComponent(
			reportMailto({ month: '2026-10', app: 'v0.64.0', plan: /** @type {any} */ (plan) })
		);
		expect(href.startsWith(`mailto:${REPORT_ADDRESS}?`)).toBe(true);
		for (const leak of ['Wolkenfabrik', 'Stromwerk', '12,34', '-1234', '56,78', 'Rechnung 4711']) {
			expect(href).not.toContain(leak);
		}
	});
});
