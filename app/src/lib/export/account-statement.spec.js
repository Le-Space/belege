import { describe, expect, it } from 'vitest';

import { accountStatement, accountStatementFile } from './account-statement.js';
import { statementPath } from './build.js';
import { planMonth } from './plan.js';

const accounts = [
	{ id: 'a', name: 'Konto A', source: 'camt', currency: 'EUR', ibanLast4: '0001' },
	{ id: 'b', name: 'Konto B', source: 'camt', currency: 'EUR', ibanLast4: '0002' },
	{ id: 'c', name: 'Konto C', source: 'camt', currency: 'EUR', ibanLast4: '0003' }
];
const tx = (
	/** @type {string} */ id,
	/** @type {string} */ accountId,
	/** @type {string} */ day,
	/** @type {number} */ cents
) => ({
	id,
	accountId,
	source: 'camt',
	bookedOn: day,
	valueDate: day,
	amountCents: cents,
	currency: 'EUR',
	counterparty: 'Wolkenfabrik Hosting GmbH',
	purpose: 'Rechnung 1',
	deleted: false
});
const books = {
	transactions: [
		tx('1', 'a', '2026-09-03', -1234),
		tx('2', 'a', '2026-09-20', 5000),
		tx('3', 'b', '2026-09-10', -990),
		tx('4', 'c', '2026-10-01', -100)
	],
	accounts,
	receipts: [],
	matches: [],
	classifications: {}
};

describe('one account, one month, as a file', () => {
	it('is the statement the month’s export holds, with the same number and file name', async () => {
		const plan = planMonth({ month: '2026-09', ...books });
		const inExport = plan.statements.find((s) => s.account.id === 'b');
		const one = accountStatement({ month: '2026-09', accountId: 'b', ...books });
		expect(one?.number).toBe(inExport?.number);
		expect(one).toEqual(inExport);
		// Each account its own number, so one file never stands for another account.
		expect(accountStatement({ month: '2026-09', accountId: 'a', ...books })?.number).not.toBe(
			one?.number
		);

		const file = await accountStatementFile(/** @type {any} */ (one), {
			created: new Date('2026-10-02T08:00:00Z')
		});
		expect(new TextDecoder('latin1').decode(file.bytes.subarray(0, 5))).toBe('%PDF-');
		expect(`Kontoauszuege/${file.fileName}`).toBe(statementPath(/** @type {any} */ (inExport)));
		expect(file.fileName).toMatch(/\.pdf$/);
	});

	it('no booking in the month, no account, no month: no statement', () => {
		expect(accountStatement({ month: '2026-09', accountId: 'c', ...books })).toBeNull();
		expect(accountStatement({ month: '2026-09', accountId: '', ...books })).toBeNull();
		expect(accountStatement({ month: '2026-9', accountId: 'a', ...books })).toBeNull();
	});
});
