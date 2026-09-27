// KI-Vorschläge for all open questions about a missing receipt: asked one by
// one, kept on the question, never linked, once per question, cancellable.
// Made-up books only.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { receipt, tx } from './fixtures.js';
import {
	aiEligible,
	aiEstimate,
	aiRun,
	cancelSuggestAll,
	dismissSuggestion,
	suggestAll,
	transferAsks
} from './ai-suggest.svelte.js';
import { saveTransferFirst } from '../jobs/workers.js';

/** @type {any} */
let store;
beforeEach(() => {
	store = {};
	for (const name of [
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'partners',
		'events'
	]) {
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	}
});

/** A bridge that picks the first candidate, or none. @param {{ none?: boolean, fail?: boolean }} [opts] */
function bridge({ none = false, fail = false } = {}) {
	/** @type {any[]} */
	const asked = [];
	return {
		asked,
		matchAssist: async (/** @type {any} */ body) => {
			asked.push(body);
			if (fail) throw new Error('down');
			return {
				pick: none
					? null
					: { id: body.candidates[0].id, confidence: 'high', reason: 'Betrag und Anbieter' },
				llm: {
					calls: [{ model: 'fake', ms: 5, usage: { prompt: 900, completion: 100 } }],
					sent: []
				}
			};
		}
	};
}

/** Put a fixture without its own id. @param {string} name @param {Record<string, any>} rec */
const add = (name, rec) => {
	const rest = { ...rec };
	delete rest.id;
	return store[name].put(rest);
};

async function seed() {
	const t1 = await add(
		'transactions',
		tx({ bookedOn: '2026-08-20', amountCents: -1999, counterparty: 'Wolkenfabrik' })
	);
	const t2 = await add(
		'transactions',
		tx({ bookedOn: '2026-08-21', amountCents: -5000, counterparty: 'Unbekannt AG' })
	);
	const r = /** @type {Record<string, any>} */ ({
		...receipt({ vendor: 'Wolkenfabrik Hosting GmbH', gross: 19.99, invoice_date: '2026-08-19' })
	});
	delete r.id;
	const rec = await store.receipts.put(r);
	const q1 = await store.questions.put({
		kind: 'missing-receipt',
		transactionId: t1.id,
		receiptId: null,
		candidates: [],
		state: 'open',
		answer: null
	});
	const q2 = await store.questions.put({
		kind: 'missing-receipt',
		transactionId: t2.id,
		receiptId: null,
		candidates: [],
		state: 'open',
		answer: null
	});
	const q3 = await store.questions.put({
		kind: 'unsure-match',
		transactionId: null,
		receiptId: rec.id,
		candidates: [],
		state: 'open',
		answer: null
	});
	return { t1, t2, rec, q1, q2, q3 };
}

describe('KI-Vorschläge for all open questions', () => {
	it('asks about missing receipts only, keeps the pick on the question, links nothing; once', async () => {
		const { rec, q1, q2, q3 } = await seed();
		const eligible = aiEligible(await store.questions.list());
		expect(eligible.map((q) => q.id).sort()).toEqual([q1.id, q2.id].sort());
		const b = bridge();
		const ctx = { client: b, store: () => store };
		expect(
			await suggestAll(
				ctx,
				eligible.map((q) => q.id)
			)
		).toBe(true);
		expect(b.asked).toHaveLength(2);
		const after = await store.questions.get(q1.id);
		expect(after.aiSuggestion).toMatchObject({
			receiptId: rec.id,
			confidence: 'high',
			model: 'fake'
		});
		expect(after.state).toBe('open');
		expect(await store.matches.list()).toEqual([]);
		expect((await store.questions.get(q3.id)).aiSuggestion).toBeUndefined();
		// A second run finds nothing left to ask.
		expect(aiEligible(await store.questions.list())).toEqual([]);
		// Events: one per request, with tokens, for the next estimate.
		const events = await store.events.list();
		expect(
			events.filter((/** @type {any} */ e) => e.kind === 'match-assist' && e.batch)
		).toHaveLength(2);
		expect(aiEstimate(events, 10)).toEqual({ requests: 10, tokens: 10000 });
	});

	it('an error counts as failed and leaves the question askable; cancel stops after the current one', async () => {
		const { q1, q2 } = await seed();
		await suggestAll({ client: bridge({ fail: true }), store: () => store }, [q1.id, q2.id]);
		expect(aiRun.failed).toBe(2);
		expect(aiEligible(await store.questions.list())).toHaveLength(2);

		const slow = bridge();
		const ctx = {
			client: {
				matchAssist: async (/** @type {any} */ body) => {
					cancelSuggestAll();
					return slow.matchAssist(body);
				}
			},
			store: () => store,
			workers: 1
		};
		await suggestAll(ctx, [q1.id, q2.id]);
		expect(slow.asked).toHaveLength(1);
		expect(aiRun.progress).toBeNull();
	});

	it('"Verwerfen" sets the suggestion aside; the question stays open', async () => {
		const { q1 } = await seed();
		await suggestAll({ client: bridge(), store: () => store }, [q1.id]);
		await dismissSuggestion(store, q1.id);
		const q = await store.questions.get(q1.id);
		expect(q.aiSuggestion.dismissed).toBe(true);
		expect(q.state).toBe('open');
	});
});

describe('"own transfer?" before the receipt (issue #109)', () => {
	/** The bridge's transfer suggestion: picks the first candidate, or none. @param {{ none?: boolean }} [opts] */
	function transferBridge({ none = false } = {}) {
		const receipts = bridge();
		/** @type {any[]} */
		const transfers = [];
		return {
			receipts,
			transfers,
			matchAssist: receipts.matchAssist,
			transferAssist: async (/** @type {any} */ body) => {
				transfers.push(body);
				return {
					pick: none
						? null
						: {
								id: body.candidates[0].id,
								confidence: 'medium',
								reason: 'Betrag abzüglich Gebühr'
							},
					llm: {
						calls: [{ model: 'fake', ms: 5, usage: { prompt: 500, completion: 50 } }],
						sent: []
					}
				};
			}
		};
	}

	/** An exchange payout that came in on the bank account, 2 % less for fees. */
	async function withPayout() {
		const seeded = await seed();
		const payout = await add(
			'transactions',
			tx({
				accountId: 'ACC-KRAKEN',
				source: 'kraken',
				bookedOn: '2026-08-19',
				amountCents: 1960,
				counterparty: 'Kraken'
			})
		);
		return { ...seeded, payout };
	}

	it('with a close other side, the transfer is suggested and no receipt is asked for', async () => {
		const { q1, q2, payout } = await withPayout();
		const b = transferBridge();
		// Only the Wolkenfabrik booking (19.99) has an other side within 15 %.
		expect(
			transferAsks(aiEligible(await store.questions.list()), await store.transactions.list())
		).toBe(1);
		await suggestAll({ client: b, store: () => store, transferFirst: true }, [q1.id, q2.id]);
		expect(b.transfers).toHaveLength(1);
		// Sent redacted, as the single suggestion sends it.
		expect(b.transfers[0].booking).toMatchObject({
			direction: 'out',
			amount: '-19,99',
			account: 'Bankkonto'
		});
		expect(b.transfers[0].candidates).toEqual([
			expect.objectContaining({ id: payout.id, direction: 'in', account: 'Börse Kraken' })
		]);
		expect((await store.questions.get(q1.id)).aiSuggestion).toMatchObject({
			kind: 'transfer',
			transactionId: payout.id,
			receiptId: null,
			confidence: 'medium'
		});
		// q1 was not asked for a receipt; q2 (nothing close) was.
		expect(b.receipts.asked).toHaveLength(1);
		expect((await store.questions.get(q2.id)).aiSuggestion.kind).toBeUndefined();
		const events = await store.events.list();
		expect(
			events.filter((/** @type {any} */ e) => e.kind === 'transfer-assist' && e.batch)
		).toHaveLength(1);
		// Nothing linked by the model.
		expect(await store.matches.list()).toEqual([]);
	});

	it('no other side named: the receipt question follows as before', async () => {
		const { q1 } = await withPayout();
		const b = transferBridge({ none: true });
		await suggestAll({ client: b, store: () => store, transferFirst: true }, [q1.id]);
		expect(b.transfers).toHaveLength(1);
		expect(b.receipts.asked).toHaveLength(1);
		expect((await store.questions.get(q1.id)).aiSuggestion).toMatchObject({ confidence: 'high' });
	});

	it('off by default: the setting decides, and no transfer request is sent', async () => {
		const { q1 } = await withPayout();
		const b = transferBridge();
		await suggestAll({ client: b, store: () => store }, [q1.id]);
		expect(b.transfers).toHaveLength(0);
		await saveTransferFirst(store.settings, true);
		const q = await store.questions.get(q1.id);
		await store.questions.put({ ...q, aiSuggestion: null });
		await suggestAll({ client: b, store: () => store }, [q1.id]);
		expect(b.transfers).toHaveLength(1);
	});
});
