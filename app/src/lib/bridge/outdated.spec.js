// What the app says when the bridge cannot answer for a reason that is not
// the person's: its node not connected (no token to fall back with), or the
// bridge older than the app. Made-up answers only.
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

describe('the bridge’s node not connected', () => {
	it('is said as that, with where to look – not “pair again”', async () => {
		answer(503, { error: 'the bridge’s node is not connected', code: 'BRIDGE_NODE_UNREACHABLE' });
		const error = await createBridgeClient()
			.llmStatus()
			.catch((/** @type {any} */ e) => e);
		expect(error.code).toBe('BRIDGE_NODE_UNREACHABLE');
		expect(error.message).toContain('nicht erreichbar');
		expect(error.message).toContain('Netzwerk');
		expect(error.message).not.toContain('neu koppeln)');
	});

	it('a real 401 still says that the bridge does not know this device', async () => {
		answer(401, { error: 'unauthorized' });
		const error = await createBridgeClient({ token: 'old' })
			.llmStatus()
			.catch((/** @type {any} */ e) => e);
		expect(error.message).toMatch(/^Die Bridge auf diesem Computer kennt dieses Gerät nicht/);
	});

	it('a call too large for the bridge’s node says so – not “pair again”', async () => {
		answer(413, { error: 'too large', code: 'BRIDGE_STREAM_TOO_LARGE' });
		const error = await createBridgeClient()
			.bookingAssist(/** @type {any} */ ({ booking: {}, accounts: [] }))
			.catch((/** @type {any} */ e) => e);
		expect(error.code).toBe('BRIDGE_STREAM_TOO_LARGE');
		expect(error.message).toContain('zu groß für den Knoten der Bridge');
		expect(error.message).not.toMatch(/kennt dieses Gerät nicht/);
	});
});

describe('a bridge older than the app', () => {
	it('a command of the catalogue it has no route for: update the bridge', async () => {
		answer(404, { error: 'not found' });
		const error = await createBridgeClient({ token: 't' })
			.llmStatus()
			.catch((/** @type {any} */ e) => e);
		expect(error.code).toBe('BRIDGE_OUTDATED');
		expect(error.status).toBe(404);
		expect(error.message).toContain('älter als diese App');
		expect(error.message).toContain('git pull, pnpm install');
	});

	it('a 404 the command itself gives (something not there) is not that', async () => {
		answer(404, { error: 'unknown account' });
		const error = await createBridgeClient({ token: 't' })
			.llmStatus()
			.catch((/** @type {any} */ e) => e);
		expect(error.code).not.toBe('BRIDGE_OUTDATED');
		expect(error.message).toBe('unknown account');
	});
});
