// The bridge client calls commands by name (@le-space/bridge-protocol, #577):
// the HTTP request it sends is the one it sent before, and the command goes
// along for a transport that calls by name. Made-up values only.
import { describe, expect, it } from 'vitest';

import { createBridgeClient } from './client.js';

/** A client whose fetch records what it got and answers `{}`. */
function recording() {
	/** @type {{ url: string, init: any }[]} */
	const calls = [];
	const client = createBridgeClient({
		url: 'http://bridge.test',
		token: 'token',
		fetch: /** @type {typeof fetch} */ (
			async (url, init) => {
				calls.push({ url: String(url), init });
				return new Response('{}', { headers: { 'content-type': 'application/json' } });
			}
		)
	});
	return { client, calls };
}

/** @param {string} url */
const pathOf = (url) => url.slice('http://bridge.test'.length);

describe('a call by name', () => {
	it('sends the path, query and body it sent before, and the command beside them', async () => {
		const { client, calls } = recording();
		/** @type {[() => Promise<unknown>, string, string, string | null, string | null][]} */
		const cases = [
			[() => client.health(), 'GET', '/health', null, 'bridge.health'],
			[() => client.accounts(), 'GET', '/hibiscus/accounts', null, 'bank.accounts'],
			[
				() => client.transactions('a1', '2026-01-01'),
				'GET',
				'/hibiscus/transactions?account=a1&since=2026-01-01',
				null,
				'bank.transactions'
			],
			[
				() => client.mailMessages('2026-01-01', '2026-02-01'),
				'GET',
				'/mail/messages?since=2026-01-01&scope=accounting&until=2026-02-01',
				null,
				'mail.messages'
			],
			[
				() =>
					client.mailSearch({
						text: 'Wolkenfabrik',
						amount: '12,34',
						from: ['example.com'],
						terms: ['Abo'],
						days: 7
					}),
				'GET',
				'/mail/search?days=7&text=Wolkenfabrik&term=Abo&amount=12%2C34&from=example.com',
				null,
				'mail.search'
			],
			[
				() => client.rate('BTC', '2026-01-01', { prefer: 'kraken' }),
				'GET',
				'/rates?asset=BTC&date=2026-01-01&prefer=kraken',
				null,
				'rates.rate'
			],
			[
				() => client.paperlessDocuments(null),
				'GET',
				'/paperless/documents',
				null,
				'paperless.documents'
			],
			[() => client.enableBankingUnlink('l1'), 'DELETE', '/enablebanking/links/l1', null, null],
			[
				() => client.walletHistory('nyx', { address: 'n1example' }),
				'POST',
				'/nyx/wallet',
				'{"address":"n1example"}',
				'chains.wallet'
			],
			[
				() => client.alephKeep('bafyexample', undefined, 12),
				'POST',
				'/backup/aleph/pin',
				'{"cid":"bafyexample","size":12}',
				'backup.keep'
			],
			[
				() => client.alephStatement('0xabc', '2026-01'),
				'GET',
				'/aleph/statement?address=0xabc&month=2026-01',
				null,
				'aleph.statement'
			]
		];
		for (const [run, method, path, body, name] of cases) {
			calls.length = 0;
			await run().catch(() => {});
			expect(calls).toHaveLength(1);
			const [{ url, init }] = calls;
			expect(init.method, path).toBe(method);
			expect(pathOf(url), path).toBe(path);
			if (body !== null) expect(init.body, path).toBe(body);
			else expect(init.body, path).toBeUndefined();
			if (name) expect(init.command?.name, path).toBe(name);
			expect(init.headers.Authorization).toBe('Bearer token');
		}
	});

	it('pairing, shares and the upload go by path only', async () => {
		const { client, calls } = recording();
		await client.pair('123456').catch(() => {});
		await client.listShares();
		await client.alephPut(new Uint8Array([1, 2]), 'backup-1');
		expect(calls.map((c) => [c.init.method, pathOf(c.url), c.init.command])).toEqual([
			['POST', '/pair', undefined],
			['GET', '/share', undefined],
			['POST', '/backup/aleph?name=backup-1', undefined]
		]);
		expect(calls[2].init.headers['Content-Type']).toBe('application/octet-stream');
	});

	it('arguments outside the schema go by path, as before', async () => {
		const { client, calls } = recording();
		await client.travelAssist(/** @type {any} */ ({ lang: 'de', unexpected: true }));
		expect(pathOf(calls[0].url)).toBe('/travel/assist');
		expect(calls[0].init.command).toBeUndefined();
	});
});
