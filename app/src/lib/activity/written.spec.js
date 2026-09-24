// Every action writes its event: bank sync, CAMT import, mail fetch,
// extraction, a matching run, each decision. Synthetic records only.
import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemoryBlockstore } from 'blockstore-core/memory';

import { memoryCollection } from '../bank/test-support.js';
import { syncHibiscus } from '../bank/hibiscus-sync.js';
import { importCamtStatements } from '../bank/import.js';
import { parseCamt053 } from '../bank/camt.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { fetchAccountingMail } from '../receipts/import.js';
import { extractReceipt } from '../receipts/extract.js';
import { runMatching } from '../matching/engine.js';
import {
	answerQuestion,
	confirmMatch,
	confirmSender,
	rejectPairs,
	setNoReceipt,
	unlinkMatch
} from '../matching/actions.js';
import { receipt, tx } from '../matching/fixtures.js';

/** @type {Record<string, any>} */
let store;

beforeEach(() => {
	store = {};
	for (const name of [
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'accounts',
		'events'
	]) {
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	}
});

/** @returns {Promise<Record<string, any>[]>} */
const events = async () => (await store.events.list()).reverse();

/** @param {'transactions' | 'receipts'} name @param {Record<string, any>} record */
async function add(name, record) {
	const rest = { ...record };
	delete rest.id;
	return store[name].put(rest);
}

describe('events written by each action', () => {
	it('Hibiscus sync: counts per run', async () => {
		const client = /** @type {any} */ ({
			transactions: async () => [
				{
					date: '2026-09-01',
					amountCents: -100,
					currency: 'EUR',
					counterpartyName: 'Test',
					purpose: 'x',
					sourceId: '1',
					fingerprint: 'f1'
				}
			]
		});
		await syncHibiscus({
			client,
			store: /** @type {any} */ (store),
			accounts: [
				/** @type {any} */ ({ id: '2', ibanLast4: '1400', name: 'Konto', currency: 'EUR' })
			],
			now: new Date('2026-09-24T12:00:00Z')
		});
		const [e] = await events();
		expect(e).toMatchObject({ kind: 'bank-sync', source: 'hibiscus', accounts: 1, new: 1 });
	});

	it('CAMT import', async () => {
		const xml = readFileSync(
			new URL('../bank/fixtures/camt053-german-bank.xml', import.meta.url),
			'utf8'
		);
		const { DOMParser } = await import('@xmldom/xmldom');
		await importCamtStatements(
			/** @type {any} */ (store),
			parseCamt053(xml, { DOMParser: /** @type {any} */ (DOMParser) })
		);
		const [e] = await events();
		expect(e).toMatchObject({ kind: 'bank-sync', source: 'camt', accounts: 1 });
		expect(e.new).toBeGreaterThan(0);
	});

	it('mail fetch: the window and the counts', async () => {
		const blobs = await createBlobStore({
			blockstore: new MemoryBlockstore(),
			key: crypto.getRandomValues(new Uint8Array(32))
		});
		const client = {
			mailMessages: async () => ({
				messages: [
					{
						id: 'bWFpbC0x',
						from: { address: 'a@b.example' },
						subject: 'Rechnung',
						auth: { verdict: 'pass' },
						attachments: [],
						excerpt: 'Summe 12,00 EUR'
					}
				]
			}),
			mailAttachment: async () => new Uint8Array()
		};
		await fetchAccountingMail({
			store: /** @type {any} */ (store),
			blobs,
			client,
			since: '2026-08-01',
			until: null
		});
		const [e] = await events();
		expect(e).toMatchObject({
			kind: 'mail-fetch',
			since: '2026-08-01',
			until: null,
			mails: 1,
			new: 1,
			verdicts: 0
		});
	});

	it('extraction: model, fallback, duration, tokens, redactions; a failure too', async () => {
		const blobs = /** @type {any} */ ({});
		const record = await add('receipts', {
			source: 'mail',
			authVerdict: 'pass',
			mime: 'text/plain',
			subject: 'Rechnung',
			excerpt: 'Summe 12,00 EUR',
			status: 'neu',
			extraction: null
		});
		const client = {
			extract: async () => ({
				extraction: { vendor: 'V', gross: 12, currency: 'EUR' },
				model: 'deepseek-flash',
				usage: { prompt: 500, completion: 312, reasoning: 200 },
				ms: 1400,
				attempts: [{ model: 'deepseek-flash', ok: true, reason: 'ok', ms: 1400 }],
				fallback: { used: false, reason: null },
				redactions: { terms: 1, iban: 0, email: 0, street: 0, postcode: 0, total: 1 },
				sentText: 'Betreff der E-Mail: Rechnung\n---\n[NAME] Summe 12,00 EUR'
			})
		};
		const updated = await extractReceipt({
			client,
			receipts: store.receipts,
			blobs,
			record,
			events: store.events
		});
		expect(updated.extractionSent).toBe(
			'Betreff der E-Mail: Rechnung\n---\n[NAME] Summe 12,00 EUR'
		);
		expect(updated.extractionInfo).toMatchObject({ model: 'deepseek-flash', ms: 1400 });
		const [e] = await events();
		expect(e).toMatchObject({
			kind: 'extract',
			receiptId: record.id,
			ok: true,
			model: 'deepseek-flash',
			fallback: false,
			ms: 1400,
			tokens: { prompt: 500, completion: 312, reasoning: 200 },
			tokensTotal: 812,
			redactions: { total: 1 }
		});
		// The event keeps no text of the receipt.
		expect(JSON.stringify(e)).not.toContain('Summe');

		const broken = {
			extract: async () => {
				throw new Error('Bridge: HTTP 502');
			}
		};
		await expect(
			extractReceipt({
				client: broken,
				receipts: store.receipts,
				blobs,
				record,
				events: store.events
			})
		).rejects.toThrow();
		const all = await events();
		expect(all.at(-1)).toMatchObject({ kind: 'extract', ok: false, error: 'Bridge: HTTP 502' });
	});

	it('matching: a manual run always, an automatic one only when it changed something', async () => {
		const t = await add(
			'transactions',
			tx({
				bookedOn: '2026-08-20',
				amountCents: -11900,
				counterparty: 'Wolkenfabrik Test GmbH',
				purpose: 'Rechnung WF-2026-0815'
			})
		);
		const r = await add(
			'receipts',
			receipt({
				vendor: 'Wolkenfabrik Test GmbH',
				invoice_number: 'WF-2026-0815',
				invoice_date: '2026-08-15',
				gross: 119
			})
		);
		await runMatching({ store: /** @type {any} */ (store), now: new Date(2026, 8, 24, 12) });
		let all = await events();
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({
			kind: 'matching',
			trigger: 'auto',
			sure: 1,
			pairs: [{ receiptId: r.id, transactionId: t.id }]
		});
		await runMatching({ store: /** @type {any} */ (store) });
		expect(await events()).toHaveLength(1);
		await runMatching({ store: /** @type {any} */ (store), trigger: 'manual' });
		all = await events();
		expect(all).toHaveLength(2);
		expect(all[1]).toMatchObject({ kind: 'matching', trigger: 'manual', sure: 0, writes: 0 });
	});

	it('decisions: confirm, link, unlink, reject, no receipt and back, confirm sender, one per answer', async () => {
		const t = await add('transactions', tx({ bookedOn: '2026-08-20', amountCents: -2242 }));
		const t2 = await add('transactions', tx({ bookedOn: '2026-08-21', amountCents: -2242 }));
		const r = await add('receipts', receipt({ vendor: 'Kaffee', gross: 22.42 }));
		const m = await confirmMatch(/** @type {any} */ (store), {
			receiptId: r.id,
			transactionId: t.id,
			reasons: ['manual']
		});
		await unlinkMatch(/** @type {any} */ (store), m.id);
		await rejectPairs(/** @type {any} */ (store), [{ receiptId: r.id, transactionId: t2.id }]);
		await setNoReceipt(/** @type {any} */ (store), t.id, 'Bewirtung');
		await setNoReceipt(/** @type {any} */ (store), t.id, null);
		const unverified = await add('receipts', {
			source: 'mail',
			authVerdict: 'fail',
			status: 'rückfrage'
		});
		await confirmSender(/** @type {any} */ (store), unverified.id);
		const q = await store.questions.put({
			kind: 'missing-receipt',
			receiptId: null,
			transactionId: t2.id,
			candidates: [],
			state: 'open',
			answer: null
		});
		await answerQuestion(/** @type {any} */ (store), q.id, { choice: 'no-receipt', reason: 'x' });
		const decisions = (await events()).filter((e) => e.kind === 'decision');
		expect(decisions.map((e) => e.action)).toEqual([
			'link',
			'unlink',
			'reject',
			'no-receipt',
			'needs-receipt',
			'confirm-sender',
			'answer'
		]);
		expect(decisions[0]).toMatchObject({ receiptId: r.id, transactionId: t.id, matchId: m.id });
		expect(decisions.at(-1)).toMatchObject({
			questionId: q.id,
			questionKind: 'missing-receipt',
			choice: 'no-receipt',
			transactionId: t2.id
		});
	});
});
