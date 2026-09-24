// The engine against the store's own collection semantics (in memory):
// automatic matches, questions, links kept in step, idempotency, and respect
// for what a person decided.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { setSetting } from '../store/settings.js';
import { receipt, tx } from './fixtures.js';
import { answerQuestion, confirmMatch, rejectPairs, setNoReceipt, unlinkMatch } from './actions.js';
import { runMatching } from './engine.js';

/** @type {Record<string, { collection: import('../store/repository.js').Collection, docs: Map<string, any> }>} */
let parts;
/** @type {import('./engine.js').MatchingStore} */
let store;
let puts = 0;

beforeEach(async () => {
	parts = {};
	for (const name of /** @type {const} */ ([
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'accounts'
	])) {
		const part = memoryCollection(name);
		const put = part.collection.put;
		part.collection.put = async (r) => {
			puts++;
			return put(r);
		};
		parts[name] = part;
	}
	store = /** @type {any} */ (
		Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.collection]))
	);
	await setSetting(store.settings, 'matching', { companyNames: ['le space UG'] });
	puts = 0;
});

/** Put a synthetic record through the collection, keeping the fixture's fields (not its id). */
async function add(
	/** @type {'transactions' | 'receipts'} */ name,
	/** @type {Record<string, any>} */ record
) {
	const rest = { ...record };
	delete rest.id;
	return store[name].put(rest);
}

/** A month at a small company, synthetic. */
async function seedMonth() {
	const t = {
		sageAug: await add(
			'transactions',
			tx({
				bookedOn: '2026-08-20',
				amountCents: -747,
				counterparty: 'Abosoft Test GmbH',
				purpose: 'AS2026071501 Abo'
			})
		),
		sageSep: await add(
			'transactions',
			tx({
				bookedOn: '2026-09-17',
				amountCents: -747,
				counterparty: 'Abosoft Test GmbH',
				purpose: 'AS 2026 081301 Abo'
			})
		),
		strom: await add(
			'transactions',
			tx({
				bookedOn: '2026-08-22',
				amountCents: -5259,
				counterparty: 'Stromwerk Test AG',
				purpose: 'Abschlag August'
			})
		),
		fee: await add(
			'transactions',
			tx({
				bookedOn: '2026-08-31',
				amountCents: -1190,
				bookingType: 'Abschluss',
				purpose: 'Abschluss per 31.08.'
			})
		),
		own: await add(
			'transactions',
			tx({
				bookedOn: '2026-08-03',
				amountCents: -50000,
				counterparty: 'le space UG',
				purpose: 'Umbuchung'
			})
		),
		income: await add(
			'transactions',
			tx({
				bookedOn: '2026-09-22',
				amountCents: 143976,
				counterparty: 'Kundin Beispiel AG',
				purpose: 'Rechnung 2026-004',
				bookingType: 'Gutschrift'
			})
		),
		coffee: await add(
			'transactions',
			tx({ bookedOn: '2026-08-12', amountCents: -2242, counterparty: 'Kaffeerösterei Test' })
		)
	};
	const r = {
		sageAug: await add(
			'receipts',
			receipt({
				vendor: 'Abosoft Test GmbH',
				invoice_number: 'AS-2026-081301',
				invoice_date: '2026-08-13',
				due_or_debit_date: '2026-09-17',
				gross: 7.47
			})
		),
		sageJul: await add(
			'receipts',
			receipt({
				document_type: 'direct_debit_notice',
				vendor: 'Abosoft Test GmbH',
				invoice_number: 'AS-2026-071501',
				invoice_date: '2026-07-15',
				due_or_debit_date: '2026-08-20',
				gross: 7.47
			})
		),
		// Amount, vendor and date, but no reference: 70, a question.
		strom: await add(
			'receipts',
			receipt({ vendor: 'Stromwerk Test AG', invoice_date: '2026-08-18', gross: 52.59 })
		),
		ours: await add(
			'receipts',
			receipt(
				{
					vendor: 'le space UG',
					invoice_number: '2026-004',
					invoice_date: '2026-09-10',
					gross: 1439.76
				},
				{ outgoing: true }
			)
		),
		card: await add(
			'receipts',
			receipt({
				vendor: 'Sprachmodell Labs PBC',
				invoice_number: 'SLX-0002',
				invoice_date: '2026-08-05',
				gross: 21.42,
				currency: 'USD',
				payment: 'card'
			})
		),
		reminder: await add(
			'receipts',
			receipt({
				document_type: 'payment_reminder',
				vendor: 'Stromwerk Test AG',
				invoice_date: '2026-08-25',
				gross: 52.59
			})
		),
		unread: await add('receipts', {
			source: 'upload',
			status: 'neu',
			fileName: 'x.pdf',
			extraction: null,
			amountCents: null
		}),
		phish: await add('receipts', {
			source: 'mail',
			status: 'rückfrage',
			authVerdict: 'fail',
			outgoing: false,
			confirmedByUser: false,
			extraction: null
		})
	};
	return { t, r };
}

const open = async () => (await store.questions.list()).filter((q) => q.state === 'open');
const active = async () =>
	(await store.matches.list()).filter((m) => m.state === 'auto' || m.state === 'confirmed');

describe('runMatching', () => {
	it('matches what is sure, asks about the rest, leaves the no-receipt bookings alone', async () => {
		const { t, r } = await seedMonth();
		const result = await runMatching({ store });

		const pairs = (await active()).map((m) => [m.receiptId, m.transactionId, m.state]);
		expect(pairs).toEqual(
			expect.arrayContaining([
				[r.sageAug.id, t.sageSep.id, 'auto'],
				[r.sageJul.id, t.sageAug.id, 'auto'],
				[r.ours.id, t.income.id, 'auto']
			])
		);
		expect(pairs).toHaveLength(3);
		expect(result.sure).toBe(3);

		const questions = await open();
		const byKind = (/** @type {string} */ k) => questions.filter((q) => q.kind === k);
		expect(byKind('unsure-match').map((q) => q.receiptId)).toEqual([r.strom.id]);
		expect(byKind('unsure-match')[0].candidates).toEqual([
			{ transactionId: t.strom.id, score: 70, reasons: ['amount', 'vendor', 'date'] }
		]);
		// The coffee has no receipt; the strom booking is already asked about; fee and own transfer need none.
		expect(byKind('missing-receipt').map((q) => q.transactionId)).toEqual([t.coffee.id]);
		expect(byKind('unknown-sender').map((q) => q.receiptId)).toEqual([r.phish.id]);
		expect(result.open).toBe(3);

		// Links in step: the booking knows its receipt, the receipt is "zugeordnet".
		expect((await store.transactions.get(t.sageSep.id))?.receiptId).toBe(r.sageAug.id);
		expect((await store.receipts.get(r.sageAug.id))?.status).toBe('zugeordnet');
		expect((await store.receipts.get(r.strom.id))?.status).toBe('ausgelesen');
		expect((await store.receipts.get(r.card.id))?.status).toBe('ausgelesen');
		expect((await store.receipts.get(r.reminder.id))?.status).toBe('ausgelesen');
		expect((await store.transactions.get(t.fee.id))?.receiptId ?? null).toBeNull();
	});

	it('is idempotent: a second run writes nothing', async () => {
		await seedMonth();
		await runMatching({ store });
		puts = 0;
		const again = await runMatching({ store });
		expect(again.writes).toBe(0);
		expect(puts).toBe(0);
		expect(again.sure).toBe(0);
	});

	it('never overrides a confirmed match or a rejected pair', async () => {
		const { t, r } = await seedMonth();
		await runMatching({ store });
		// The person links the Stromwerk receipt to the coffee booking (why not) …
		await confirmMatch(store, { receiptId: r.strom.id, transactionId: t.coffee.id });
		// … and undoes the automatic Sage match.
		const sage = (await active()).find((m) => m.receiptId === r.sageAug.id);
		await unlinkMatch(store, /** @type {any} */ (sage).id);
		await runMatching({ store });

		const now = await active();
		expect(now.find((m) => m.receiptId === r.strom.id)).toMatchObject({
			transactionId: t.coffee.id,
			state: 'confirmed'
		});
		expect(now.find((m) => m.receiptId === r.sageAug.id)).toBeUndefined();
		expect((await store.transactions.get(t.sageSep.id))?.receiptId).toBeNull();
		expect((await store.receipts.get(r.sageAug.id))?.status).toBe('ausgelesen');
		// Its question about the Stromwerk receipt resolved itself.
		const q = (await store.questions.list()).find(
			(x) => x.kind === 'unsure-match' && x.receiptId === r.strom.id
		);
		expect(q).toMatchObject({ state: 'answered', answer: { choice: 'auto', by: 'engine' } });
		// Idempotent after decisions too.
		puts = 0;
		expect((await runMatching({ store })).writes).toBe(0);
	});

	it('an answered question stays answered; "none of these" reopens only for a new candidate', async () => {
		const { t, r } = await seedMonth();
		await runMatching({ store });
		const q = (await open()).find((x) => x.kind === 'unsure-match');
		await answerQuestion(store, /** @type {any} */ (q).id, { choice: 'none' });
		await runMatching({ store });
		expect((await store.questions.get(/** @type {any} */ (q).id))?.state).toBe('answered');
		// The pair it offered is rejected now.
		expect((await store.matches.list()).find((m) => m.receiptId === r.strom.id)).toMatchObject({
			transactionId: t.strom.id,
			state: 'rejected'
		});
		// A new booking that fits the receipt: the question comes back with it alone.
		const late = await add(
			'transactions',
			tx({ bookedOn: '2026-08-24', amountCents: -5259, counterparty: 'Stromwerk Test AG' })
		);
		await runMatching({ store });
		const back = await store.questions.get(/** @type {any} */ (q).id);
		expect(back?.state).toBe('open');
		expect(back?.candidates.map((/** @type {any} */ c) => c.transactionId)).toEqual([late.id]);
	});

	it('answers: pick a candidate, no receipt needed, confirm a sender, ignore', async () => {
		const { t, r } = await seedMonth();
		await runMatching({ store });
		const qs = await open();
		const unsure = /** @type {any} */ (qs.find((x) => x.kind === 'unsure-match'));
		const missing = /** @type {any} */ (qs.find((x) => x.kind === 'missing-receipt'));
		const sender = /** @type {any} */ (qs.find((x) => x.kind === 'unknown-sender'));

		await answerQuestion(store, unsure.id, { choice: 'candidate', transactionId: t.strom.id });
		expect((await store.transactions.get(t.strom.id))?.receiptId).toBe(r.strom.id);
		expect((await store.receipts.get(r.strom.id))?.status).toBe('zugeordnet');

		await answerQuestion(store, missing.id, {
			choice: 'no-receipt',
			reason: 'Bewirtung, Beleg verloren'
		});
		expect((await store.transactions.get(t.coffee.id))?.noReceipt).toMatchObject({
			reason: 'Bewirtung, Beleg verloren'
		});

		await answerQuestion(store, sender.id, { choice: 'confirm-sender' });
		expect(await store.receipts.get(r.phish.id)).toMatchObject({
			confirmedByUser: true,
			status: 'neu'
		});

		const result = await runMatching({ store });
		expect(result.open).toBe(0);
		const all = await store.questions.list();
		expect(all.every((q) => q.state === 'answered')).toBe(true);
	});

	it('ignoring an unknown sender sets the receipt aside', async () => {
		const { r } = await seedMonth();
		await runMatching({ store });
		const sender = /** @type {any} */ ((await open()).find((x) => x.kind === 'unknown-sender'));
		await answerQuestion(store, sender.id, { choice: 'ignore' });
		expect((await store.receipts.get(r.phish.id))?.status).toBe('ignoriert');
	});

	it('no receipt needed: undoes the booking’s match, and can be taken back', async () => {
		const { t, r } = await seedMonth();
		await runMatching({ store });
		await setNoReceipt(store, t.sageSep.id, 'doppelt gebucht');
		expect((await store.transactions.get(t.sageSep.id))?.receiptId).toBeNull();
		expect((await store.receipts.get(r.sageAug.id))?.status).toBe('ausgelesen');
		await runMatching({ store });
		expect((await active()).find((m) => m.transactionId === t.sageSep.id)).toBeUndefined();
		await setNoReceipt(store, t.sageSep.id, null);
		expect((await store.transactions.get(t.sageSep.id))?.noReceipt).toBeNull();
	});

	it('a confirmed link moves a receipt: its automatic match elsewhere is rejected', async () => {
		const { t, r } = await seedMonth();
		await runMatching({ store });
		await confirmMatch(store, { receiptId: r.sageAug.id, transactionId: t.sageAug.id });
		const mine = (await store.matches.list()).filter((m) => m.receiptId === r.sageAug.id);
		expect(mine.map((m) => [m.transactionId, m.state]).sort()).toEqual(
			[
				[t.sageAug.id, 'confirmed'],
				[t.sageSep.id, 'rejected']
			].sort()
		);
		// Two receipts on one booking now: it shows the first one linked.
		expect((await store.transactions.get(t.sageAug.id))?.receiptId).toBeTruthy();
	});

	it('drops matches whose receipt was deleted', async () => {
		const { t, r } = await seedMonth();
		await runMatching({ store });
		await store.receipts.softDelete(r.ours.id);
		await runMatching({ store });
		expect((await active()).find((m) => m.receiptId === r.ours.id)).toBeUndefined();
		expect((await store.transactions.get(t.income.id))?.receiptId).toBeNull();
	});

	it('rejectPairs is safe to repeat', async () => {
		const { t, r } = await seedMonth();
		await rejectPairs(store, [{ receiptId: r.card.id, transactionId: t.coffee.id }]);
		puts = 0;
		await rejectPairs(store, [{ receiptId: r.card.id, transactionId: t.coffee.id }]);
		expect(puts).toBe(0);
	});

	it('own rules from the settings take a booking out of matching', async () => {
		const { t } = await seedMonth();
		await setSetting(store.settings, 'matching', {
			companyNames: ['le space UG'],
			rules: [{ id: 'k', field: 'counterparty', contains: 'Kaffeerösterei', action: 'private' }]
		});
		await runMatching({ store });
		expect((await open()).find((q) => q.transactionId === t.coffee.id)).toBeUndefined();
	});
});
