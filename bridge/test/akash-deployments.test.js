// An Akash wallet's deployments with what each cost (#305): from the node's
// deployment list (paged), decimal uact summed to ACT, block times from the
// indexer, each block asked once. Every address, dseq and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createAkashDeploymentsClient, decUnits } from '../src/chains/akash-deployments.js';

const ADDRESS = `akash1${'q'.repeat(38)}`;
const REST = 'https://rest.example';
const INDEXER = 'https://indexer.example';

/** @param {string} dseq @param {number} created @param {number} settled @param {string} transferred */
const dep = (dseq, created, settled, transferred, state = 'closed') => ({
	deployment: { id: { owner: ADDRESS, dseq }, state, created_at: String(created) },
	escrow_account: {
		id: { scope: 'deployment', xid: `${ADDRESS}/${dseq}` },
		state: {
			owner: ADDRESS,
			state,
			transferred: [{ denom: 'uact', amount: transferred }],
			settled_at: String(settled),
			funds: [{ denom: 'uact', amount: '1000000.000000000000000000' }],
			deposits: []
		}
	}
});

test('decimal uact as whole units, half up', () => {
	assert.equal(decUnits('49.000000000000000000'), 49n);
	assert.equal(decUnits('49.5'), 50n);
	assert.equal(decUnits('0.4'), 0n);
	assert.equal(decUnits('nonsense'), 0n);
});

test('the deployments, two pages, with ACT and the blocks’ times', async () => {
	/** @type {string[]} */
	const calls = [];
	/** @type {typeof fetch} */
	const f = async (input) => {
		const url = new URL(String(input));
		calls.push(url.pathname + (url.searchParams.get('pagination.key') ? '?key' : ''));
		if (url.origin === REST) {
			assert.equal(url.searchParams.get('filters.owner'), ADDRESS);
			const second = url.searchParams.get('pagination.key') === 'next';
			return Response.json(
				second
					? {
							deployments: [dep('20', 300, 300, '0.000000000000000000', 'active')],
							pagination: { next_key: null }
						}
					: {
							deployments: [
								dep('10', 100, 200, '2500000.400000000000000000'),
								dep('11', 100, 150, '49.000000000000000000')
							],
							pagination: { next_key: 'next' }
						}
			);
		}
		const h = Number(url.pathname.split('/').pop());
		return Response.json({
			height: h,
			datetime: new Date(Date.UTC(2026, 6, 1) + h * 60_000).toISOString()
		});
	};
	const list = await createAkashDeploymentsClient({ fetch: f }).deployments({
		address: ADDRESS,
		rest: REST,
		indexer: INDEXER
	});
	assert.deepEqual(
		list.map((d) => [d.dseq, d.state, d.transferred, d.funds, d.createdAt, d.settledAt]),
		[
			['10', 'closed', '2.5', '1', '2026-07-01T01:40:00.000Z', '2026-07-01T03:20:00.000Z'],
			['11', 'closed', '0.000049', '1', '2026-07-01T01:40:00.000Z', '2026-07-01T02:30:00.000Z'],
			['20', 'active', '0', '1', '2026-07-01T05:00:00.000Z', '2026-07-01T05:00:00.000Z']
		]
	);
	// Height 100 asked once for both deployments created in it.
	assert.equal(calls.filter((c) => c === '/v1/blocks/100').length, 1);
	assert.equal(calls.filter((c) => c.startsWith('/akash/')).length, 2);
});

test('a node without deployments in its answer is an error', async () => {
	const f = /** @type {typeof fetch} */ (async () => Response.json({ error: 'nope' }));
	await assert.rejects(
		createAkashDeploymentsClient({ fetch: f }).deployments({
			address: ADDRESS,
			rest: REST,
			indexer: INDEXER
		}),
		(/** @type {any} */ e) => e.code === 'WALLET_DATA'
	);
});

test('the ACT held now, from the node’s balances; none is 0', async () => {
	/** @param {any[]} balances */
	const node = (balances) =>
		/** @type {typeof fetch} */ (
			async (input) => {
				assert.match(String(input), /\/cosmos\/bank\/v1beta1\/balances\//);
				return Response.json({ balances, pagination: { next_key: null } });
			}
		);
	const client = (/** @type {any[]} */ b) => createAkashDeploymentsClient({ fetch: node(b) });
	assert.equal(
		await client([
			{ denom: 'uakt', amount: '49110337' },
			{ denom: 'uact', amount: '7503515' }
		]).actBalance({ address: ADDRESS, rest: REST }),
		'7.503515'
	);
	assert.equal(await client([]).actBalance({ address: ADDRESS, rest: REST }), '0');
});
