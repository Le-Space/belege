import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeClient, setRedactTerms } from './client.js';

/** A bridge that answers every call with `answer` and keeps what it was sent. */
function bridge(answer = {}) {
	/** @type {{ url: string, body: any }[]} */
	const calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
			return new Response(JSON.stringify(answer), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
	return calls;
}

afterEach(() => {
	setRedactTerms(() => []);
	vi.unstubAllGlobals();
});

describe('the company names go with every call to the language model (#226)', () => {
	it('adds them to the five LLM routes, and to no other', async () => {
		const calls = bridge();
		setRedactTerms(() => ['Beispiel GmbH', 'Muster UG']);
		const client = /** @type {any} */ (
			createBridgeClient({ url: 'http://127.0.0.1:8765', token: 'made-up' })
		);
		await client.mailAssist({ counterparty: 'x' });
		await client.matchAssist({ booking: {} });
		await client.transferAssist({ booking: {} });
		await client.vendorAssist({ vendor: 'x' });
		await client.extract({ text: 'x' });
		await client.createShare({ year: 2026 });
		expect(calls.map((c) => [new URL(c.url).pathname, c.body.redactTerms])).toEqual([
			['/mail/assist', ['Beispiel GmbH', 'Muster UG']],
			['/match/assist', ['Beispiel GmbH', 'Muster UG']],
			['/transfer/assist', ['Beispiel GmbH', 'Muster UG']],
			['/vendor/assist', ['Beispiel GmbH', 'Muster UG']],
			['/extract', ['Beispiel GmbH', 'Muster UG']],
			['/share', undefined]
		]);
	});

	it('puts the name back where the model repeats the mark: an own invoice keeps its vendor', async () => {
		bridge({ extraction: { vendor: '[FIRMA]', summary: 'Rechnung von [FIRMA] an Kundin' } });
		setRedactTerms(() => ['Beispiel GmbH']);
		const client = createBridgeClient({ url: 'http://127.0.0.1:8765', token: 'made-up' });
		const result = await client.extract({ text: 'x' });
		expect(result.extraction).toEqual({
			vendor: 'Beispiel GmbH',
			summary: 'Rechnung von Beispiel GmbH an Kundin'
		});
	});
});
