// One invoice, paid in instalments (issue #258): what is open, how a part is
// scored, and the engine linking each instalment to the same invoice as it
// arrives. Made-up invoice, customer and amounts.
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryCollection } from '../bank/test-support.js';
import { setSetting } from '../store/settings.js';
import { receipt, tx } from './fixtures.js';
import { confirmMatch, unlinkMatch } from './actions.js';
import { runMatching } from './engine.js';
import { instalmentOf, settlement } from './instalments.js';
import { receiptFacts, scorePair, txFacts } from './score.js';
import { receiptChoices } from './view.js';

const invoice = () =>
	receipt(
		{
			document_type: 'invoice',
			vendor: 'Musterfirma UG',
			invoice_number: '2025-017',
			invoice_date: '2026-01-10',
			gross: 10000
		},
		{ customer: 'Kunde Beispiel', ownInvoice: true }
	);
const pay = (
	/** @type {string} */ day,
	/** @type {number} */ cents,
	/** @type {string} */ purpose
) =>
	tx({
		bookedOn: day,
		amountCents: cents,
		counterparty: 'Kunde Beispiel',
		purpose,
		bookingType: 'Gutschrift'
	});

describe('settlement', () => {
	const r = { id: 'R1', amountCents: 1_000_000 };
	const t = (/** @type {string} */ id, /** @type {number} */ cents, day = '2026-01-15') => ({
		id,
		amountCents: cents,
		bookedOn: day
	});
	const link = (/** @type {string} */ id, state = 'confirmed') => ({
		receiptId: 'R1',
		transactionId: id,
		state
	});

	it('open, partly paid, paid and over-paid, from the links alone', () => {
		const txs = [
			t('a', 350_000),
			t('b', 350_000, '2026-02-13'),
			t('c', 300_000, '2026-03-14'),
			t('d', 10_000)
		];
		expect(settlement(r, [], txs).state).toBe('open');
		const two = settlement(r, [link('b'), link('a')], txs);
		expect(two).toMatchObject({ state: 'partial', paidCents: 700_000, openCents: 300_000 });
		expect(two.payments.map((p) => p.id)).toEqual(['a', 'b']);
		expect(instalmentOf(two, 'b')).toEqual({ index: 2, count: 2 });
		expect(settlement(r, [link('a'), link('b'), link('c')], txs).state).toBe('paid');
		const over = settlement(r, [link('a'), link('b'), link('c'), link('d')], txs);
		expect(over).toMatchObject({ state: 'overpaid', overCents: 10_000, openCents: 0 });
		// A rejected link is no payment.
		expect(settlement(r, [link('a', 'rejected')], txs).state).toBe('open');
		// One payment for the whole invoice is no instalment.
		expect(
			instalmentOf(settlement({ id: 'R1', amountCents: 350_000 }, [link('a')], txs), 'a')
		).toBeNull();
	});
});

describe('another currency', () => {
	// A USD invoice paid from a EUR account by card: −38,37 € for 40,00 USD.
	const usd = { id: 'R2', amountCents: 4_000, currency: 'USD' };
	const link = (/** @type {string} */ id) => ({
		receiptId: 'R2',
		transactionId: id,
		state: 'confirmed'
	});
	const card = (/** @type {string} */ id, /** @type {any} */ original, cents = -3_837) => ({
		id,
		amountCents: cents,
		currency: 'EUR',
		bookedOn: '2025-01-20',
		...(original ? { original } : {})
	});

	it('counts a payment by its original amount in the invoice’s currency: paid, no instalment', () => {
		const s = settlement(usd, [link('a')], [card('a', { amount: '40.00', currency: 'USD' })]);
		expect(s).toMatchObject({ state: 'paid', openCents: 0, paidCents: 4_000, comparable: true });
		expect(instalmentOf(s, 'a')).toBeNull();
	});

	it('never takes euros for dollars: without an original amount, paid by its link, nothing open', () => {
		const s = settlement(usd, [link('a')], [card('a', null)]);
		expect(s).toMatchObject({ state: 'paid', openCents: 0, comparable: false });
		expect(instalmentOf(s, 'a')).toBeNull();
	});

	it('instalments in another currency add up in the invoice’s', () => {
		const one = card('a', { amount: '20.00', currency: 'USD' }, -1_900);
		const two = {
			...card('b', { amount: '20.00', currency: 'USD' }, -1_910),
			bookedOn: '2025-02-20'
		};
		expect(settlement(usd, [link('a')], [one])).toMatchObject({
			state: 'partial',
			openCents: 2_000
		});
		expect(settlement(usd, [link('a'), link('b')], [one, two]).state).toBe('paid');
	});
});

describe('scoring a part', () => {
	it('a payment below the total scores as an instalment when the purpose says so, or the invoice is partly paid', () => {
		const r = /** @type {any} */ (receiptFacts(invoice(), { companyNames: ['Musterfirma UG'] }));
		const words = scorePair(
			r,
			txFacts(pay('2026-01-15', 350_000, 'Teilzahlung Rechnung 2025-017-1'))
		);
		expect(words.reasons).toContain('instalment');
		const plain = scorePair(r, txFacts(pay('2026-01-15', 350_000, 'Rechnung 2025-017')));
		expect(plain.reasons).not.toContain('instalment');
		// The word without the invoice's number: a utility's monthly "Abschlag" is no part of this.
		const word = scorePair(r, txFacts(pay('2026-01-15', 5_259, 'Abschlag Januar')));
		expect(word.reasons).not.toContain('instalment');
		// Partly paid: what is open is the amount to meet, and a later date is no sign against it.
		const rest = /** @type {any} */ (
			receiptFacts(invoice(), { companyNames: ['Musterfirma UG'] }, 700_000)
		);
		const last = scorePair(rest, txFacts(pay('2026-06-30', 300_000, 'Rechnung 2025-017')));
		expect(last.reasons).toContain('remaining-amount');
		expect(last.reasons).not.toContain('far-date');
		const more = scorePair(rest, txFacts(pay('2026-06-30', 400_000, 'Rechnung 2025-017')));
		expect(more.reasons).not.toContain('instalment');
		expect(more.reasons).not.toContain('remaining-amount');
	});
});

describe('the engine, instalment by instalment', () => {
	/** @type {import('./engine.js').MatchingStore} */
	let store;
	beforeEach(async () => {
		store = /** @type {any} */ (
			Object.fromEntries(
				/** @type {const} */ ([
					'transactions',
					'receipts',
					'matches',
					'questions',
					'settings',
					'accounts'
				]).map((n) => [n, memoryCollection(n).collection])
			)
		);
		await setSetting(store.settings, 'matching', { companyNames: ['Musterfirma UG'] });
	});
	const add = async (/** @type {'transactions' | 'receipts'} */ name, /** @type {any} */ r) => {
		const rest = { ...r };
		delete rest.id;
		return store[name].put(rest);
	};
	const state = async (/** @type {string} */ receiptId) =>
		settlement(
			/** @type {any} */ (await store.receipts.get(receiptId)),
			await store.matches.list(),
			await store.transactions.list()
		);

	it('links each instalment to the same invoice, and the rest settles it', async () => {
		const r = await add('receipts', invoice());
		const first = await add(
			'transactions',
			pay('2026-01-15', 350_000, 'Teilzahlung Rechnung 2025-017-1')
		);
		await runMatching({ store, now: new Date('2026-01-16') });
		expect((await store.transactions.get(first.id))?.receiptId).toBe(r.id);
		expect((await state(r.id)).openCents).toBe(650_000);

		const second = await add(
			'transactions',
			pay('2026-02-13', 350_000, 'Teilzahlung Rechnung 2025-017-2')
		);
		await runMatching({ store, now: new Date('2026-02-14') });
		expect((await store.transactions.get(second.id))?.receiptId).toBe(r.id);
		expect((await state(r.id)).openCents).toBe(300_000);

		const rest = await add(
			'transactions',
			pay('2026-03-14', 300_000, 'Restzahlung Rechnung 2025-017')
		);
		await runMatching({ store, now: new Date('2026-03-15') });
		expect((await store.transactions.get(rest.id))?.receiptId).toBe(r.id);
		expect((await state(r.id)).state).toBe('paid');

		// Paid: a further payment naming the invoice is not linked to it by itself.
		const extra = await add('transactions', pay('2026-03-20', 10_000, 'Rechnung 2025-017'));
		await runMatching({ store, now: new Date('2026-03-21') });
		expect((await store.transactions.get(extra.id))?.receiptId ?? null).toBeNull();

		// Unlinking one instalment reopens just that part.
		const m = (await store.matches.list()).find((x) => x.transactionId === second.id);
		await unlinkMatch(store, /** @type {any} */ (m).id);
		const after = await state(r.id);
		expect(after).toMatchObject({ state: 'partial', openCents: 350_000 });
		expect(after.payments.map((p) => p.id)).toEqual([first.id, rest.id]);
	});

	it('by hand: a partly paid invoice is offered again, and linking it alongside keeps the others', async () => {
		const r = await add('receipts', invoice());
		const first = await add('transactions', pay('2026-01-15', 350_000, 'Rechnung 2025-017'));
		const second = await add('transactions', pay('2026-02-13', 350_000, 'Zahlung'));
		await confirmMatch(store, { receiptId: r.id, transactionId: first.id, reasons: ['manual'] });
		const [txs, receipts, matches] = await Promise.all([
			store.transactions.list(),
			store.receipts.list(),
			store.matches.list()
		]);
		const offered = receiptChoices(/** @type {any} */ (second), receipts, matches, {
			companyNames: ['Musterfirma UG'],
			transactions: txs
		}).find((c) => c.receipt.id === r.id);
		expect(offered?.alongside?.openCents).toBe(650_000);
		expect(offered?.reasons).toContain('instalment');
		// Without the transactions the old rule stands: linked elsewhere is not offered.
		expect(
			receiptChoices(/** @type {any} */ (second), receipts, matches).some(
				(c) => c.receipt.id === r.id
			)
		).toBe(false);

		await confirmMatch(store, {
			receiptId: r.id,
			transactionId: second.id,
			reasons: ['manual'],
			alongside: true
		});
		const both = await state(r.id);
		expect(both.payments.map((p) => p.id)).toEqual([first.id, second.id]);
		// Without `alongside`, a link moves as before.
		await confirmMatch(store, { receiptId: r.id, transactionId: second.id, reasons: ['manual'] });
		expect((await state(r.id)).payments.map((p) => p.id)).toEqual([second.id]);
	});
});

describe('exporting instalments', () => {
	it('every instalment carries the invoice number, and the invoice file goes in once', async () => {
		const { planMonth } = await import('../export/plan.js');
		const r = { ...invoice(), id: 'R-INV', fileCid: 'cid-inv', mime: 'application/pdf' };
		const booking = { account: '1400', taxKey: '', confirmedAt: '2026-09-30T00:00:00Z' };
		const a = { ...pay('2026-09-05', 350_000, 'Teilzahlung 2025-017-1'), id: 'T-A', booking };
		const b = { ...pay('2026-09-25', 350_000, 'Teilzahlung 2025-017-2'), id: 'T-B', booking };
		const plan = planMonth({
			month: '2026-09',
			transactions: [a, b],
			accounts: [
				{ id: 'ACC-GLS', source: 'hibiscus', name: 'Geschäftskonto Test', ledgerAccount: '1200' }
			],
			receipts: [r],
			matches: [
				{ id: 'M-A', transactionId: 'T-A', receiptId: 'R-INV', state: 'confirmed' },
				{ id: 'M-B', transactionId: 'T-B', receiptId: 'R-INV', state: 'confirmed' }
			],
			classifications: {}
		});
		const numbers = plan.lines.map((l) => l.line.receiptNumber);
		expect(numbers).toHaveLength(2);
		expect(new Set(numbers).size).toBe(1);
		expect(numbers[0]).toMatch(/^2026-09-\d{3}$/);
		expect(plan.receipts.map((x) => x.id)).toEqual(['R-INV']);
	});
});
