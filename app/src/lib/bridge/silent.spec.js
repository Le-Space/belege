// What the app says when no bridge answers follows the bridge the books
// expect (#844): a hosted one is never asked for with `pnpm bridge`.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createBridgeClient, setExpectedBridge } from './client.js';
import { currentLocale, setLocale } from '../i18n/index.js';
import { wayOutOf } from '../help/way-out.js';

const refused = () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('refused')));
const nodeGone = () =>
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify({ code: 'BRIDGE_NODE_UNREACHABLE' }), {
					status: 503,
					headers: { 'content-type': 'application/json' }
				})
		)
	);
const failure = () =>
	createBridgeClient()
		.llmStatus()
		.catch((/** @type {any} */ e) => e);

afterEach(() => {
	vi.unstubAllGlobals();
	setExpectedBridge(() => null);
});

describe('no bridge answers', () => {
	it('not known which is expected: the bridge on a computer is asked for, as before', async () => {
		refused();
		const error = await failure();
		expect(error.status).toBe(0);
		expect(error.message).toContain('pnpm bridge');
		expect(wayOutOf(error.message)?.command).toBe('pnpm bridge');
	});

	it('the books expect the bridge on a computer: the same', async () => {
		refused();
		setExpectedBridge(() => 'local');
		expect((await failure()).message).toContain('pnpm bridge');
	});

	it.each(['aleph', 'near'])(
		'the books expect the hosted bridge (%s): where to start it',
		async (which) => {
			refused();
			setExpectedBridge(async () => /** @type {'aleph' | 'near'} */ (which));
			const error = await failure();
			expect(error.status).toBe(0);
			expect(error.message).not.toContain('pnpm bridge');
			expect(error.message).toContain(which === 'aleph' ? 'Aleph' : 'Phala');
			expect(error.message).toContain('Bridge');
			// Its way out is its page, never a command for the terminal.
			expect(wayOutOf(error.message)).toEqual({ kind: 'hosted', href: '/integrationen/bridge' });
		}
	);

	it('a hosted bridge whose node is not connected: the same text, the code kept', async () => {
		nodeGone();
		setExpectedBridge(() => 'aleph');
		const error = await failure();
		expect(error.code).toBe('BRIDGE_NODE_UNREACHABLE');
		expect(error.status).toBe(503);
		expect(error.message).toContain('Aleph');
	});

	it('a computer’s bridge whose node is not connected keeps its own text', async () => {
		nodeGone();
		setExpectedBridge(() => 'local');
		const error = await failure();
		expect(error.code).toBe('BRIDGE_NODE_UNREACHABLE');
		expect(error.message).not.toContain('Aleph');
		expect(error.message).not.toContain('pnpm bridge');
	});

	it('asking which bridge fails: the text for a computer, not an error of its own', async () => {
		refused();
		setExpectedBridge(async () => {
			throw new Error('books closed');
		});
		expect((await failure()).message).toContain('pnpm bridge');
	});

	it('says it in German and in English', async () => {
		refused();
		setExpectedBridge(() => 'aleph');
		const before = currentLocale();
		try {
			const texts = [];
			for (const l of ['de', 'en']) {
				setLocale(/** @type {any} */ (l));
				texts.push((await failure()).message);
			}
			expect(new Set(texts).size).toBe(2);
		} finally {
			setLocale(before);
		}
	});
});
