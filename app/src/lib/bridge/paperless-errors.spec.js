// What the app says when Paperless behind the bridge cannot be used: the
// bridge's code in the app's language, with the cause the bridge named – not
// the bridge's English text. Made-up answers only.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeClient } from './client.js';

/** @param {number} status @param {Record<string, unknown>} body */
function answer(status, body) {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify(body), {
					status,
					headers: { 'content-type': 'application/json' }
				})
		)
	);
}

afterEach(() => vi.unstubAllGlobals());

describe('Paperless behind the bridge', () => {
	it('an unreachable Paperless: said in the app’s language, with the cause, and the code kept', async () => {
		answer(502, {
			error: 'Paperless is not reachable (ECONNREFUSED)',
			code: 'PAPERLESS_UNREACHABLE'
		});
		const error = await createBridgeClient({ token: 't' })
			.paperlessDocuments(null)
			.catch((/** @type {any} */ e) => e);
		expect(error.code).toBe('PAPERLESS_UNREACHABLE');
		expect(error.message).toContain('ECONNREFUSED');
		expect(error.message).toContain('pnpm setup:paperless');
		expect(error.message).not.toContain('is not reachable');
	});

	it('a refused token and a timeout each get their own message', async () => {
		answer(502, { error: 'Paperless refused the token', code: 'PAPERLESS_AUTH' });
		const auth = await createBridgeClient({ token: 't' })
			.paperlessDocuments(null)
			.catch((/** @type {any} */ e) => e);
		expect(auth.code).toBe('PAPERLESS_AUTH');
		expect(auth.message).not.toBe('Paperless refused the token');

		answer(504, { error: 'Paperless did not answer within 30 s', code: 'PAPERLESS_TIMEOUT' });
		const late = await createBridgeClient({ token: 't' })
			.paperlessDocuments(null)
			.catch((/** @type {any} */ e) => e);
		expect(late.code).toBe('PAPERLESS_TIMEOUT');
		expect(late.message).not.toContain('did not answer within');
	});
});
