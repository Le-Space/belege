// Read shares for an assistant (issue #124): created with the pairing token,
// read by id without one, never by a web page, gone when expired or revoked,
// and nothing of the data in the log. Made-up data only.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createShares } from '../src/shares.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';

describe('read shares', () => {
	let clock = Date.parse('2026-09-27T10:00:00Z');
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	/** @type {number} */ let port;
	/** @type {string} */ let token;
	/** @type {string[]} */ const logged = [];

	before(async () => {
		/** @type {{ hash: string, createdAt: string }[]} */
		let hashes = [];
		const pairing = createPairing({
			getHashes: () => hashes,
			saveHashes: async (h) => {
				hashes = h;
			}
		});
		bridge = createBridgeServer({
			config: { ...defaultConfig(), appOrigins: [APP] },
			pairing,
			hibiscus: null,
			shares: createShares({ now: () => clock }),
			log: (l) => logged.push(l)
		});
		port = (await bridge.listen({ port: 0 })).port;
		token = await pairing.pair(pairing.issueCode());
	});
	after(async () => {
		await bridge?.close();
	});

	const data = { transactions: [{ day: '2026-06-15', amount: '-15,00', payee: 'Funkmobil Test' }] };
	const create = (/** @type {any} */ body) =>
		request(port, '/share', {
			method: 'POST',
			headers: { origin: APP, authorization: `Bearer ${token}` },
			body
		});

	test('created with the token, read by id without one, listed without data', async () => {
		const res = await create({ scope: 'Zahlungen 2026', redacted: true, minutes: 60, data });
		assert.equal(res.status, 200);
		const { id, expiresAt } = res.json;
		assert.match(id, /^[A-Za-z0-9_-]{22}$/);
		assert.equal(expiresAt, '2026-09-27T11:00:00.000Z');

		const read = await request(port, `/share/${id}`, {});
		assert.equal(read.status, 200);
		assert.deepEqual(read.json, data);
		assert.equal(read.headers['access-control-allow-origin'], undefined);

		const list = await request(port, '/share', {
			headers: { origin: APP, authorization: `Bearer ${token}` }
		});
		assert.deepEqual(
			list.json.shares.map((/** @type {any} */ s) => [s.scope, s.reads, 'body' in s]),
			[['Zahlungen 2026', 1, false]]
		);
		assert.equal(logged.join('\n').includes(id), false, 'the id is not logged');
		assert.equal(logged.join('\n').includes('Funkmobil'), false, 'no data in the log');
	});

	test('a web page cannot read it; a wrong id is 404', async () => {
		const { id } = (await create({ scope: 'x', redacted: true, minutes: 5, data })).json;
		const fromPage = await request(port, `/share/${id}`, { headers: { origin: APP } });
		assert.equal(fromPage.status, 403);
		const evil = await request(port, `/share/${id}`, {
			headers: { origin: 'https://evil.example' }
		});
		assert.equal(evil.status, 403);
		assert.equal((await request(port, `/share/${'A'.repeat(22)}`, {})).status, 404);
	});

	test('revoked or expired: gone; creating needs the token and a whole body', async () => {
		const { id } = (await create({ scope: 'x', redacted: false, minutes: 10, data })).json;
		const del = await request(port, `/share/${id}`, {
			method: 'DELETE',
			headers: { origin: APP, authorization: `Bearer ${token}` }
		});
		assert.equal(del.status, 200);
		assert.equal((await request(port, `/share/${id}`, {})).status, 404);

		const { id: soon } = (await create({ scope: 'y', redacted: true, minutes: 1, data })).json;
		clock += 61_000;
		assert.equal((await request(port, `/share/${soon}`, {})).status, 404);

		const noToken = await request(port, '/share', {
			method: 'POST',
			headers: { origin: APP },
			body: { scope: 'z', redacted: true, minutes: 5, data }
		});
		assert.equal(noToken.status, 401);
		assert.equal((await create({ scope: 'z', minutes: 5, data })).status, 400);
	});

	test('at most 24 hours', async () => {
		const res = await create({ scope: 'long', redacted: true, minutes: 99999, data });
		assert.equal(Date.parse(res.json.expiresAt) - clock, 24 * 3600_000);
	});
});
