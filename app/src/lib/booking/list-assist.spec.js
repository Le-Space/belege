// "✦ Konten vorschlagen" for a list of payments: which ones the model is asked
// about, one call each with the payment's own question, the first pick kept,
// an error that costs the rest and not what was answered, and "Anhalten".
// Synthetic vendors, accounts and amounts only.
import { beforeEach, describe, expect, it } from 'vitest';

import {
	MAX_LIST_ASSIST,
	askForList,
	listAssist,
	resetListAssist,
	stopListAssist,
	suggestFor,
	toAsk
} from './list-assist.svelte.js';

const NOW = '2026-10-13T10:00:00Z';
const tx = (/** @type {string} */ id, /** @type {Record<string, any>} */ over = {}) => ({
	id,
	bookedOn: '2026-10-13',
	counterparty: `Firma ${id} AG`,
	purpose: 'Rechnung',
	amountCents: -1234,
	accountId: 'bank',
	...over
});
const session = (/** @type {Record<string, any>} */ over = {}) => ({
	classifications: {},
	matches: [],
	receipts: [],
	partners: [],
	accounts: [{ id: 'bank', name: 'Konto A' }],
	datevSettings: null,
	travel: [],
	chart: null,
	...over
});
const learnedName = (/** @type {string} */ v) => `gebucht für ${v}`;

beforeEach(() => resetListAssist());

describe('toAsk', () => {
	it('leaves out what is confirmed, what the books suggest themselves and what was asked', () => {
		const app = session({
			partners: [
				{ id: 'P1', name: 'Wolkenfabrik Hosting GmbH', aliases: ['wolkenfabrik'], account: '4964' }
			],
			classifications: { own: { kind: 'own-transfer' } }
		});
		const txs = [
			tx('open'),
			tx('done', { booking: { account: '4930', taxKey: '', confirmedAt: NOW } }),
			tx('learned', { counterparty: 'WOLKENFABRIK 4711' }),
			tx('asked')
		];
		expect(suggestFor(txs[2], app).account).toBe('4964');
		expect(
			toAsk(txs, app, { asked: { account: null, confidence: '', reason: '' } }).map((t) => t.id)
		).toEqual(['open']);
	});

	it('at most MAX_LIST_ASSIST a click', () => {
		const many = Array.from({ length: MAX_LIST_ASSIST + 7 }, (_, i) => tx(`t${i}`));
		expect(toAsk(many, session(), {})).toHaveLength(MAX_LIST_ASSIST);
	});
});

describe('askForList', () => {
	it('asks once per payment, with that payment, and keeps the first pick', async () => {
		/** @type {any[]} */
		const bodies = [];
		/** @type {any[]} */
		const events = [];
		const client = {
			bookingAssist: async (/** @type {any} */ body) => {
				bodies.push(body);
				return body.booking.counterparty === 'Firma a AG'
					? {
							picks: [
								{ account: '4964', confidence: 'high', reason: 'Software-Abo.' },
								{ account: '4930', confidence: 'low', reason: 'Vielleicht Bürobedarf.' }
							],
							llm: { calls: [{ model: 'm', ms: 5, usage: { prompt: 10, completion: 2 } }] }
						}
					: { picks: [], llm: { calls: [] } };
			}
		};
		const store = { events: { put: async (/** @type {any} */ e) => events.push(e) } };
		await askForList({
			txs: [tx('a'), tx('b'), tx('c', { booking: { account: '4930', confirmedAt: NOW } })],
			app: session(),
			client,
			store,
			learnedName
		});
		expect(bodies.map((b) => b.booking.counterparty)).toEqual(['Firma a AG', 'Firma b AG']);
		expect(bodies[0].booking).toMatchObject({
			direction: 'out',
			amount: '12,34',
			day: '2026-10-13'
		});
		expect(bodies[0].accounts.length).toBeGreaterThan(10);
		expect(listAssist.picks).toEqual({
			a: { account: '4964', confidence: 'high', reason: 'Software-Abo.' },
			b: { account: null, confidence: '', reason: '' }
		});
		expect(listAssist).toMatchObject({ busy: false, done: 2, total: 2, error: null });
		expect(events.map((e) => [e.kind, e.transactionId, e.picks])).toEqual([
			['booking-assist', 'a', 2],
			['booking-assist', 'b', 0]
		]);

		// Asked once: a second click has nothing left for these.
		await askForList({ txs: [tx('a'), tx('b')], app: session(), client, store, learnedName });
		expect(bodies).toHaveLength(2);
	});

	it('an error stops the run and keeps what was answered', async () => {
		let n = 0;
		const client = {
			bookingAssist: async () => {
				if (++n === 2) throw new Error('Die KI antwortet nicht.');
				return { picks: [{ account: '4930', confidence: 'medium', reason: 'Papier.' }] };
			}
		};
		await askForList({
			txs: [tx('a'), tx('b'), tx('c')],
			app: session(),
			client,
			store: null,
			learnedName
		});
		expect(Object.keys(listAssist.picks)).toEqual(['a']);
		expect(listAssist).toMatchObject({
			busy: false,
			done: 1,
			total: 3,
			error: 'Die KI antwortet nicht.'
		});
	});

	it('"Anhalten" ends it after the payment under way', async () => {
		const client = {
			bookingAssist: async () => {
				stopListAssist();
				return { picks: [{ account: '4930', confidence: 'high', reason: 'Papier.' }] };
			}
		};
		await askForList({ txs: [tx('a'), tx('b')], app: session(), client, store: null, learnedName });
		expect(Object.keys(listAssist.picks)).toEqual(['a']);
		expect(listAssist).toMatchObject({ busy: false, stopping: false, done: 1, total: 2 });
	});
});
