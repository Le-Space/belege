// The Verlauf's records: what an event may carry, how the page filters them,
// the totals of the KI card, and the line the page shows for each kind.
import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { extractionTotals, filterEvents, recordEvent } from './events.js';
import { describeEvent } from './view.js';

describe('recordEvent', () => {
	it('writes kind, at and the fields; drops undefined; nothing without a collection', async () => {
		const { collection: events } = memoryCollection('events');
		const e = await recordEvent(
			events,
			'extract',
			{
				receiptId: 'R1',
				model: 'deepseek-flash',
				fallbackReason: undefined,
				tokens: { prompt: 1 }
			},
			{ now: () => new Date('2026-09-24T10:00:00Z') }
		);
		expect(e).toMatchObject({
			kind: 'extract',
			at: '2026-09-24T10:00:00.000Z',
			receiptId: 'R1',
			model: 'deepseek-flash',
			tokens: { prompt: 1 }
		});
		expect(e && 'fallbackReason' in e).toBe(false);
		expect(await recordEvent(null, 'extract', {})).toBeNull();
		expect(await recordEvent(undefined, 'matching', {})).toBeNull();
	});

	it('refuses a field a secret or a receipt text would sit in, and unknown kinds', async () => {
		const { collection: events } = memoryCollection('events');
		for (const field of ['token', 'password', 'apiKey', 'key', 'text', 'sentText', 'purpose']) {
			await expect(recordEvent(events, 'extract', { [field]: 'x' })).rejects.toThrow(field);
		}
		await expect(recordEvent(events, 'extract', { nested: { secret: 'x' } })).rejects.toThrow(
			'secret'
		);
		await expect(recordEvent(events, /** @type {any} */ ('login'), {})).rejects.toThrow();
		expect(await events.list()).toHaveLength(0);
	});
});

describe('filterEvents and extractionTotals', () => {
	const events = [
		{ id: '01A', kind: 'mail-fetch', at: '2026-09-24T08:00:00Z' },
		{
			id: '01B',
			kind: 'extract',
			ok: true,
			model: 'deepseek-flash',
			tokensTotal: 812,
			at: '2026-09-24T09:00:00Z'
		},
		{
			id: '01C',
			kind: 'extract',
			ok: true,
			model: 'deepseek-v4-pro',
			fallback: true,
			tokens: { prompt: 100, completion: 50 },
			at: '2026-09-24T10:00:00Z'
		},
		{ id: '01D', kind: 'extract', ok: false, error: 'HTTP 500', at: '2026-09-24T11:00:00Z' },
		{ id: '01E', kind: 'matching', at: '2026-09-24T12:00:00Z' },
		{ id: '01F', kind: 'decision', action: 'unlink', at: '2026-09-24T13:00:00Z' },
		{ id: '01G', kind: 'extract', deleted: true, tokensTotal: 9999, at: '2026-09-24T14:00:00Z' }
	];

	it('newest first; by group', () => {
		expect(filterEvents(events).map((e) => e.id)).toEqual([
			'01F',
			'01E',
			'01D',
			'01C',
			'01B',
			'01A'
		]);
		expect(filterEvents(events, 'auslesen').map((e) => e.id)).toEqual(['01D', '01C', '01B']);
		expect(filterEvents(events, 'abgleich').map((e) => e.id)).toEqual(['01E']);
		expect(filterEvents(events, 'abruf').map((e) => e.id)).toEqual(['01A']);
		expect(filterEvents(events, 'entscheidungen').map((e) => e.id)).toEqual(['01F']);
	});

	it('calls, tokens (the whole call where known), failures, fallbacks, the last one', () => {
		expect(extractionTotals(events)).toEqual({
			calls: 3,
			failed: 1,
			fallbacks: 1,
			tokens: 962,
			lastAt: '2026-09-24T11:00:00Z',
			lastModel: null
		});
		expect(extractionTotals([])).toMatchObject({ calls: 0, tokens: 0, lastAt: null });
	});
});

describe('describeEvent', () => {
	const receipts = [{ id: 'R1', vendor: 'Wolkenfabrik Hosting GmbH' }];
	const transactions = [{ id: 'T1', counterparty: 'Wolkenfabrik', bookedOn: '2026-09-20' }];
	const books = { receipts, transactions };

	it('an extraction: model, seconds, tokens, redactions, and why a second attempt', () => {
		const d = describeEvent(
			{
				kind: 'extract',
				ok: true,
				receiptId: 'R1',
				model: 'deepseek-v4-pro',
				ms: 1400,
				tokensTotal: 1812,
				redactions: { total: 7 },
				fallback: true,
				fallbackReason: 'checks failed: net + VAT is not gross'
			},
			books
		);
		expect(d.title).toBe('Beleg ausgelesen');
		expect(d.text).toBe(
			'Wolkenfabrik Hosting GmbH · deepseek-v4-pro · 1,4 s · 1.812 Tokens · 7 Stellen geschwärzt · zweiter Versuch, weil die Antwort nicht aufging (net + VAT is not gross)'
		);
		expect(d.receiptId).toBe('R1');
		const failed = describeEvent(
			{ kind: 'extract', ok: false, receiptId: 'R1', error: 'HTTP 500' },
			books
		);
		expect(failed).toMatchObject({ failed: true, title: 'Auslesen fehlgeschlagen' });
	});

	it('a matching run links its one pair; a decision names receipt and booking', () => {
		const run = describeEvent(
			{
				kind: 'matching',
				trigger: 'manual',
				sure: 1,
				created: 2,
				resolved: 0,
				classified: 3,
				waiting: 1,
				pairs: [{ receiptId: 'R1', transactionId: 'T1', score: 140 }]
			},
			books
		);
		expect(run.title).toBe('Abgleich (von dir gestartet)');
		expect(run.text).toBe(
			'1 zugeordnet · 2 neue Rückfragen · 0 erledigt · 3 ohne Beleg-Pflicht · 1 warten noch · Zugeordnet: Wolkenfabrik Hosting GmbH'
		);
		expect(run).toMatchObject({ receiptId: 'R1', transactionId: 'T1' });
		const d = describeEvent(
			{ kind: 'decision', action: 'unlink', receiptId: 'R1', transactionId: 'T1' },
			books
		);
		expect(d.title).toBe('Zuordnung gelöst');
		expect(d.text).toBe('Wolkenfabrik Hosting GmbH · Wolkenfabrik · 20.09.2026');
		expect(
			describeEvent({ kind: 'decision', action: 'answer', choice: 'no-receipt' }, books).title
		).toBe('Rückfrage beantwortet: kein Beleg nötig');
	});

	it('a record that is gone: no link, a dash', () => {
		const d = describeEvent({ kind: 'extract', ok: true, receiptId: 'GONE', ms: 10 }, books);
		expect(d.receiptId).toBeNull();
		expect(d.text.startsWith('— ·')).toBe(true);
	});
});
