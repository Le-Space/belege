// Twin own transfers (issue #176). Made-up accounts, IBANs and amounts only.
import { describe, expect, it } from 'vitest';

import { ibanKey } from '../bank/fingerprint.js';
import { buildMatchingContext } from './context.js';
import { classifyTransaction } from './classify.js';
import { classificationLine } from './explain.js';
import { mutualTwin, pickTwin, purposeKey } from './twins.js';

const IBAN_B = 'DE00000000000000000002';

describe('telling twins apart', () => {
	const a = { id: 'a', bookedOn: '2026-03-16', purpose: 'KI Abo Werkzeug' };
	it('the same purpose, then the clearly nearer day; two equal ones are no pick', () => {
		const x = { id: 'x', bookedOn: '2026-03-14', purpose: 'Abo Werkzeug' };
		const y = { id: 'y', bookedOn: '2026-03-14', purpose: 'KI  Abo-Werkzeug' };
		expect(purposeKey(y.purpose)).toBe('ki abo werkzeug');
		expect(pickTwin(a, [x, y])?.id).toBe('y');
		const near = { id: 'n', bookedOn: '2026-03-15', purpose: 'Anderes' };
		const far = { id: 'f', bookedOn: '2026-03-12', purpose: 'Anderes' };
		expect(pickTwin(a, [far, near])?.id).toBe('n');
		expect(pickTwin(a, [{ ...near, id: 'n2' }, near])).toBeNull();
		expect(mutualTwin(a, [x, y], () => [a])?.id).toBe('y');
		expect(mutualTwin(a, [x, y], () => [{ ...a, id: 'other' }, a].slice(0, 1))).toBeNull();
	});
});

describe('two own transfers of the same amount, the IBAN on one side only', async () => {
	const accounts = [
		{ id: 'acc-a', source: 'hibiscus', name: 'Konto A', ibanLast4: '0001' },
		{
			id: 'acc-b',
			source: 'camt',
			name: 'Konto B',
			ibanLast4: '0002',
			sourceAccountId: await ibanKey(IBAN_B)
		}
	];
	const out = (/** @type {string} */ id, /** @type {string} */ purpose) => ({
		id,
		accountId: 'acc-a',
		source: 'hibiscus',
		bookedOn: '2026-03-16',
		amountCents: -10000,
		currency: 'EUR',
		counterparty: 'Beispiel UG',
		counterpartyIban: IBAN_B,
		purpose
	});
	const into = (/** @type {string} */ id, /** @type {string} */ purpose) => ({
		id,
		accountId: 'acc-b',
		source: 'camt',
		bookedOn: '2026-03-14',
		amountCents: 10000,
		currency: 'EUR',
		counterparty: 'BEISPIEL UG',
		counterpartyIban: '',
		purpose
	});
	const books = [
		out('a1', 'KI Abo Werkzeug'),
		out('a2', 'Abo Werkzeug'),
		into('b1', 'KI Abo Werkzeug'),
		into('b2', 'Abo Werkzeug')
	];

	it('each debit finds its credit by purpose; the credits are covered too', async () => {
		const ctx = await buildMatchingContext({ accounts, transactions: books, settings: null });
		const c = Object.fromEntries(books.map((t) => [t.id, classifyTransaction(t, ctx)]));
		expect(c.a1).toMatchObject({ kind: 'own-transfer', via: 'iban', counterBookingId: 'b1' });
		expect(c.a2).toMatchObject({ kind: 'own-transfer', via: 'iban', counterBookingId: 'b2' });
		expect(c.b1).toMatchObject({
			kind: 'own-transfer',
			via: 'counter-booking',
			counterBookingId: 'a1'
		});
		expect(c.b2).toMatchObject({ kind: 'own-transfer', counterBookingId: 'a2' });
		expect(classificationLine(/** @type {any} */ (c.a1), { accounts })).toContain('verknüpft');
	});

	it('a bank that appends its TAN method and "IBAN: … BIC: …" on one side: still the same purpose', async () => {
		const gls = books.map((t) =>
			t.accountId === 'acc-a'
				? { ...t, purpose: `${t.purpose} SecureGo plus IBAN: ${IBAN_B} BIC: TESTDEFFXXX` }
				: t
		);
		expect(purposeKey(gls[0].purpose)).toBe('ki abo werkzeug');
		const ctx = await buildMatchingContext({ accounts, transactions: gls, settings: null });
		expect(classifyTransaction(gls[0], ctx)).toMatchObject({ counterBookingId: 'b1' });
		expect(classifyTransaction(gls[1], ctx)).toMatchObject({ counterBookingId: 'b2' });
		expect(classifyTransaction(gls[2], ctx)).toMatchObject({ counterBookingId: 'a1' });
	});

	it('the same purpose on both: no guess – the debits stay transfers, the credits stay open', async () => {
		const same = [out('a1', 'Abo'), out('a2', 'Abo'), into('b1', 'Abo'), into('b2', 'Abo')];
		const ctx = await buildMatchingContext({ accounts, transactions: same, settings: null });
		expect(classifyTransaction(same[0], ctx)?.counterBookingId).toBeUndefined();
		expect(classifyTransaction(same[2], ctx)).toBeNull();
	});

	it('the named account has nothing that fits: said so', async () => {
		const alone = [out('a1', 'KI Abo Werkzeug')];
		const ctx = await buildMatchingContext({ accounts, transactions: alone, settings: null });
		const c = classifyTransaction(alone[0], ctx);
		expect(c).toMatchObject({ via: 'iban', counterMissing: true });
		expect(classificationLine(/** @type {any} */ (c), { accounts })).toContain(
			'keine Gegenbuchung'
		);
	});

	it('without any IBAN, a transfer word on both sides: twins paired by purpose all the same', async () => {
		const plain = books.map((t) => ({
			...t,
			counterpartyIban: '',
			purpose: `Umbuchung ${t.purpose}`
		}));
		const ctx = await buildMatchingContext({ accounts, transactions: plain, settings: null });
		expect(classifyTransaction(plain[0], ctx)).toMatchObject({
			via: 'counter-booking',
			counterBookingId: 'b1'
		});
		expect(classifyTransaction(plain[3], ctx)).toMatchObject({ counterBookingId: 'a2' });
	});
});
