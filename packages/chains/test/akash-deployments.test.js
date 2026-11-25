// An Akash wallet's deployments with what each cost (#305): from the node's
// deployment list (paged), decimal uact summed to ACT, block times from the
// indexer, each block asked once. Every address, dseq and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	ACT_PRICE_SOURCE,
	akashUsageEntries,
	createAkashDeploymentsClient,
	decUnits,
	fromMicro,
	usageInMonth
} from '../src/akash-deployments.js';

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

test('a block the indexer did not give this time is asked for again next time', async () => {
	let indexerDown = true;
	/** @type {string[]} */
	const calls = [];
	/** @type {typeof fetch} */
	const f = async (input) => {
		const url = new URL(String(input));
		calls.push(url.pathname);
		if (url.origin === REST) {
			return Response.json({
				deployments: [dep('10', 100, 150, '49.000000000000000000')],
				pagination: { next_key: null }
			});
		}
		if (indexerDown) return new Response('down', { status: 503 });
		const h = Number(url.pathname.split('/').pop());
		return Response.json({
			height: h,
			datetime: new Date(Date.UTC(2026, 6, 1) + h * 60_000).toISOString()
		});
	};
	const client = createAkashDeploymentsClient({
		fetch: f,
		timeoutMs: 1_000,
		sleep: async () => {}
	});
	const ask = () => client.deployments({ address: ADDRESS, rest: REST, indexer: INDEXER });
	const [first] = await ask();
	assert.equal(first.createdAt, null);
	assert.equal(first.settledAt, null);
	indexerDown = false;
	const [second] = await ask();
	assert.equal(second.createdAt, '2026-07-01T01:40:00.000Z');
	assert.equal(second.settledAt, '2026-07-01T02:30:00.000Z');
	assert.ok(
		calls.filter((c) => c === '/v1/blocks/100').length >= 2,
		'asked again once the indexer answers'
	);
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

/** @param {Partial<import('../src/akash-deployments.js').AkashDeployment>} d */
const deployment = (d) => ({
	dseq: '1000',
	state: 'closed',
	createdAt: '2026-07-10T00:00:00.000Z',
	settledAt: '2026-07-20T00:00:00.000Z',
	transferred: '1',
	...d
});

// Moved with usageInMonth from Belege's app/src/lib/akash/akash.spec.js.
test('usageInMonth: a deployment within the month counts whole; one across two months is split by time', () => {
	const within = deployment({ dseq: '1' });
	// 10 days in June, 20 in July.
	const across = deployment({
		dseq: '2',
		createdAt: '2026-06-21T00:00:00.000Z',
		settledAt: '2026-07-21T00:00:00.000Z',
		transferred: '3'
	});
	assert.deepEqual(
		usageInMonth([within, across], '2026-07').map((u) => [u.dseq, u.inMonth]),
		[
			['1', '1'],
			['2', '2']
		]
	);
	assert.deepEqual(
		usageInMonth([within, across], '2026-06').map((u) => [u.dseq, u.inMonth]),
		[['2', '1']]
	);
	assert.deepEqual(usageInMonth([within], '2026-08'), []);
});

test('usageInMonth: one that lived no time counts where it was created; one without times is left out', () => {
	const instant = deployment({ settledAt: '2026-07-10T00:00:00.000Z', transferred: '0.5' });
	assert.equal(usageInMonth([instant], '2026-07')[0].inMonth, '0.5');
	assert.deepEqual(usageInMonth([deployment({ createdAt: null })], '2026-07'), []);
	assert.equal(fromMicro(-1_500_000n), '-1.5');
});

test('akashUsageEntries: one usage entry per deployment with a share in the month, in ACT at 1 USD, no wallet movement', () => {
	const entries = akashUsageEntries({
		address: ADDRESS,
		month: '2026-07',
		deployments: [
			deployment({ dseq: '1' }),
			deployment({
				dseq: '2',
				createdAt: '2026-06-21T00:00:00.000Z',
				settledAt: '2026-07-21T00:00:00.000Z',
				transferred: '3'
			}),
			// Nothing paid out yet: no entry.
			deployment({ dseq: '3', transferred: '0' })
		]
	});
	assert.deepEqual(
		entries.map((e) => [
			e.id,
			e.kind,
			e.type,
			e.asset,
			e.amount,
			e.counterpartyLabel,
			e.time,
			e.hash
		]),
		[
			[
				`akash:${ADDRESS}:usage:2026-07:1`,
				'usage',
				'sent',
				'ACT',
				'-1',
				'Deployment 1',
				'2026-07-31T23:59:59.000Z',
				''
			],
			[
				`akash:${ADDRESS}:usage:2026-07:2`,
				'usage',
				'sent',
				'ACT',
				'-2',
				'Deployment 2',
				'2026-07-31T23:59:59.000Z',
				''
			]
		]
	);
	assert.equal(entries[1].memo, 'Laufzeit 2026-06-21 – 2026-07-21, gesamt 3 ACT, Anteil 66.7 %');
	assert.deepEqual(entries[0].unitPrice, {
		currency: 'USD',
		amount: '1',
		source: ACT_PRICE_SOURCE
	});
	assert.match(entries[0].explorerUrl, /mintscan\.io\/akash\/accounts\/akash1/);
});
