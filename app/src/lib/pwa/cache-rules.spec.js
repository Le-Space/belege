import { describe, expect, it } from 'vitest';

import { SHELL, cacheDecision, shellFiles } from './cache-rules.js';

const origin = 'http://localhost:4173';
const assets = new Set(
	shellFiles(['/_app/immutable/entry/app.js', '/_app/immutable/x.js.map'], ['/favicon.svg'])
);
/** @param {string} href @param {{ method?: string, mode?: string }} [r] */
const decide = (href, { method = 'GET', mode = 'cors' } = {}) =>
	cacheDecision(new URL(href, origin), { origin, assets, method, mode });

describe('what the service worker caches', () => {
	it('the shell: built and static files, the page; no source maps', () => {
		expect([...assets]).toEqual(['/_app/immutable/entry/app.js', '/favicon.svg', SHELL]);
		expect(decide('/_app/immutable/entry/app.js')).toBe('asset');
		expect(decide('/favicon.svg')).toBe('asset');
		expect(decide('/zahlungen', { mode: 'navigate' })).toBe('navigate');
		expect(decide('/?year=2026', { mode: 'navigate' })).toBe('navigate');
	});

	it('never anything with data: the bridge, relays, APIs, other requests', () => {
		for (const href of [
			'http://127.0.0.1:8765/hibiscus/transactions?account=1',
			'http://127.0.0.1:8765/health',
			'https://api2.aleph.im/api/v0/addresses/0x0/balance',
			'wss://relay.example/p2p',
			'https://data-api.ecb.europa.eu/service/data/EXR',
			'/_app/version.json',
			'/_app/immutable/entry/app.js?v=2'
		])
			expect(decide(href)).toBe('network');
		expect(decide('/favicon.svg', { method: 'POST' })).toBe('network');
	});
});
