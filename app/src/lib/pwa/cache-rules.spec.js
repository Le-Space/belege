import { describe, expect, it } from 'vitest';

import { FALLBACK, START, cacheDecision, shellFiles, shellFor } from './cache-rules.js';

const origin = 'http://localhost:4173';
const build = ['/_app/immutable/entry/app.js', '/_app/immutable/x.js.map'];
const files = ['/favicon.svg', '/social/belege-de.png', '/en/index.html', '/robots.txt'];
const assets = new Set(shellFiles(build, files));
/** @param {string} href @param {{ method?: string, mode?: string }} [r] */
const decide = (href, { method = 'GET', mode = 'cors' } = {}) =>
	cacheDecision(new URL(href, origin), { origin, assets, method, mode });

describe('what the service worker caches', () => {
	it('the shell: built and static files, both pages; no source maps, nothing only previews read', () => {
		expect([...assets]).toEqual(['/_app/immutable/entry/app.js', '/favicon.svg', START, FALLBACK]);
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

	it('offline, a navigation gets the start page at the root and the fallback deeper', () => {
		expect(shellFor('/')).toBe('/');
		expect(shellFor('/zahlungen')).toBe('/200.html');
		expect(shellFor('/reisen/abc')).toBe('/200.html');
	});

	it('under a path (an IPFS path gateway) every cached path carries the prefix', () => {
		const prefix = '/ipfs/bafybeigdyrzt';
		const under = (/** @type {string[]} */ paths) => paths.map((f) => prefix + f);
		expect(shellFiles(under(build), under(files), prefix)).toEqual([
			`${prefix}/_app/immutable/entry/app.js`,
			`${prefix}/favicon.svg`,
			`${prefix}/`,
			`${prefix}/200.html`
		]);
		expect(shellFor(`${prefix}/`, prefix)).toBe(`${prefix}/`);
		expect(shellFor(`${prefix}/zahlungen`, prefix)).toBe(`${prefix}/200.html`);
	});
});
