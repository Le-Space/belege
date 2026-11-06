import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { sum, toUnits } from '@le-space/ledger';
import { fetchRaw, isAccountId, mapRaw } from '../src/near.js';

const fixture = async (name) =>
	JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

test('a relayer day (real public data): one exact fee entry per signed transaction', async () => {
	const raw = await fixture('relay-aurora-2026-11-01.json');
	const entries = mapRaw(raw);
	assert.equal(entries.length, raw.txns.length);
	assert.ok(
		entries.every((e) => e.type === 'fee' && e.counterparty === 'near' && e.asset === 'NEAR')
	);
	// exactly what NearBlocks gives, in yoctoNEAR, no float in between
	const first = raw.txns.find((t) => t.transaction_hash === entries[0].hash);
	const yocto = BigInt(first.outcomes_agg.transaction_fee);
	assert.equal(toUnits(entries[0].amount, 24), -yocto);
	assert.ok(entries[0].explorerUrl.endsWith(entries[0].hash));
	assert.match(sum(entries.map((e) => e.amount)), /^-0\.\d+$/);
});

test('an airdropped token (real public data) is listed but has no price', async () => {
	const raw = await fixture('relay-aurora-2024-05-13.json');
	const ft = mapRaw(raw).filter((e) => e.contract !== 'native');
	assert.equal(ft.length, 1);
	assert.equal(ft[0].type, 'received');
	assert.equal(ft[0].priceAs, '');
	assert.equal(ft[0].amount, '100');
});

// Made-up accounts below, for the cases the public fixtures do not have.
const row = (over) => ({
	transaction_hash: 'HASH1',
	block_timestamp: '1791000000000000000',
	block: { block_height: '1' },
	signer_account_id: 'wolkenfabrik.testnet',
	receiver_account_id: 'stromwerk.testnet',
	actions: [{ action: 'TRANSFER', method: null }],
	actions_agg: { deposit: '1500000000000000000000000' },
	outcomes: { status: true },
	outcomes_agg: { transaction_fee: '446365125000000000000' },
	...over
});

test('a NEAR transfer gives the payment and its fee; a failed one only the fee', () => {
	const ok = mapRaw({
		account: 'wolkenfabrik.testnet',
		network: 'testnet',
		txns: [row({})],
		ftTxns: []
	});
	assert.deepEqual(
		ok.map((e) => [e.type, e.kind, e.amount, e.counterparty]),
		[
			['sent', 'transfer', '-1.5', 'stromwerk.testnet'],
			['fee', 'fee', '-0.000446365125', 'near']
		]
	);
	const failed = mapRaw({
		account: 'wolkenfabrik.testnet',
		network: 'testnet',
		txns: [row({ outcomes: { status: false } })],
		ftTxns: []
	});
	assert.deepEqual(
		failed.map((e) => e.type),
		['fee']
	);
});

test('storage deposits and staking are kinds of their own; the 1 yocto of a token transfer is no payment', () => {
	const account = 'wolkenfabrik.testnet';
	const e = mapRaw({
		account,
		network: 'testnet',
		txns: [
			row({
				transaction_hash: 'S',
				actions: [{ action: 'FUNCTION_CALL', method: 'storage_deposit' }],
				actions_agg: { deposit: '1250000000000000000000' }
			}),
			row({
				transaction_hash: 'K',
				actions: [{ action: 'FUNCTION_CALL', method: 'deposit_and_stake' }]
			}),
			row({
				transaction_hash: 'F',
				actions: [{ action: 'FUNCTION_CALL', method: 'ft_transfer' }],
				actions_agg: { deposit: '1' }
			})
		],
		ftTxns: []
	});
	const sent = e.filter((x) => x.type === 'sent');
	assert.deepEqual(sent.map((x) => [x.hash, x.kind]).sort(), [
		['K', 'stake'],
		['S', 'storage']
	]);
	assert.equal(e.filter((x) => x.type === 'fee').length, 3);
});

test('NEAR received from someone else, and USDC sent: listed and priced', () => {
	const account = 'wolkenfabrik.testnet';
	const e = mapRaw({
		account,
		network: 'testnet',
		txns: [row({ signer_account_id: 'stromwerk.testnet', receiver_account_id: account })],
		ftTxns: [
			{
				affected_account_id: account,
				involved_account_id: 'stromwerk.testnet',
				contract_account_id: '3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af',
				delta_amount: '-12340000',
				transaction_hash: 'U',
				receipt_id: 'R',
				event_index: 1,
				block_timestamp: '1791000001000000000',
				block: { block_height: '2' },
				cause: 'TRANSFER',
				meta: { symbol: 'USDC', decimals: 6 }
			}
		]
	});
	assert.deepEqual(
		e.map((x) => [x.type, x.asset, x.amount, x.priceAs]),
		[
			['received', 'NEAR', '1.5', 'NEAR'],
			['sent', 'USDC', '-12.34', 'USDC']
		]
	);
});

test('fetchRaw walks pages newest first and stops at the start of the period', async () => {
	const t = (d) => (BigInt(Date.parse(d)) * 1_000_000n).toString();
	/** @type {string[]} */
	const urls = [];
	const pages = {
		'': {
			data: [row({ transaction_hash: 'A', block_timestamp: t('2026-10-20T00:00:00Z') })],
			meta: { next_page: 'p2' }
		},
		p2: {
			data: [
				row({ transaction_hash: 'B', block_timestamp: t('2026-10-02T00:00:00Z') }),
				row({ transaction_hash: 'C', block_timestamp: t('2026-09-30T23:59:59Z') })
			],
			meta: { next_page: 'p3' }
		}
	};
	const fetch = async (url) => {
		urls.push(url);
		const u = new URL(url);
		const body = u.pathname.endsWith('/ft-txns')
			? { data: [], meta: {} }
			: pages[u.searchParams.get('next') ?? ''];
		return new Response(JSON.stringify(body), { status: 200 });
	};
	const raw = await fetchRaw({
		account: 'wolkenfabrik.testnet',
		network: 'testnet',
		from: '2026-10-01',
		to: '2026-10-31',
		fetch
	});
	assert.deepEqual(
		raw.txns.map((r) => r.transaction_hash),
		['A', 'B']
	);
	assert.equal(new URL(urls[0]).searchParams.get('before_ts'), t('2026-11-01T00:00:00Z'));
	assert.equal(urls.length, 3);
});

test('account ids are checked before anything is fetched', async () => {
	assert.ok(isAccountId('relay.aurora'));
	assert.ok(isAccountId('a'.repeat(64)));
	assert.ok(!isAccountId('../etc'));
	assert.ok(!isAccountId('Upper.near'));
	await assert.rejects(
		fetchRaw({ account: 'x/../y', from: '2026-10-01', to: '2026-10-31' }),
		/not a NEAR account id/
	);
});

test('a storage deposit counts what the contract kept, not what was attached', async () => {
	const { storageKept } = await import('../src/near.js');
	const account = 'wolkenfabrik.testnet';
	const [sent] = mapRaw({
		account,
		network: 'testnet',
		txns: [
			row({
				transaction_hash: 'S',
				receiver_account_id: 'usdc.fakes.testnet',
				actions: [{ action: 'FUNCTION_CALL', method: 'storage_deposit' }],
				actions_agg: { deposit: '125000000000000000000000' }
			})
		],
		ftTxns: []
	}).filter((e) => e.type === 'sent');
	const rpc = (refund) => async () =>
		new Response(
			JSON.stringify({
				result: {
					receipts: [
						{
							predecessor_id: account,
							receiver_id: 'usdc.fakes.testnet',
							receipt: {
								Action: { actions: [{ FunctionCall: { deposit: '125000000000000000000000' } }] }
							}
						},
						{
							predecessor_id: 'system',
							receiver_id: account,
							receipt: { Action: { actions: [{ Transfer: { deposit: '999' } }] } }
						},
						...(refund
							? [
									{
										predecessor_id: 'usdc.fakes.testnet',
										receiver_id: account,
										receipt: { Action: { actions: [{ Transfer: { deposit: refund } }] } }
									}
								]
							: [])
					]
				}
			})
		);
	assert.equal(
		(await storageKept([sent], { network: 'testnet', fetch: rpc('123750000000000000000000') }))[0]
			.amount,
		'-0.00125'
	);
	assert.equal(
		(await storageKept([sent], { network: 'testnet', fetch: rpc('125000000000000000000000') }))
			.length,
		0
	);
	assert.equal(
		(await storageKept([sent], { network: 'testnet', fetch: rpc('') }))[0].amount,
		'-0.125'
	);
	await assert.rejects(
		storageKept([sent], {
			network: 'testnet',
			fetch: async () => new Response('', { status: 503 })
		}),
		/could not tell/
	);
});

test('a listed token keeps its decimals without the indexer; an unknown one without decimals is skipped', () => {
	const account = 'wolkenfabrik.testnet';
	const ft = (contract, meta) => ({
		affected_account_id: account,
		involved_account_id: 'stromwerk.testnet',
		contract_account_id: contract,
		delta_amount: '-1500000',
		transaction_hash: 'U',
		receipt_id: 'R',
		event_index: 1,
		block_timestamp: '1791000001000000000',
		block: { block_height: '2' },
		cause: 'TRANSFER',
		...(meta ? { meta } : {})
	});
	const e = mapRaw({
		account,
		network: 'testnet',
		txns: [],
		ftTxns: [
			ft('3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af'),
			ft('mystery.testnet')
		]
	});
	assert.deepEqual(
		e.map((x) => [x.asset, x.amount]),
		[['USDC', '-1.5']]
	);
});

test('the archival RPC is asked again after a rate limit or a failed fetch', async () => {
	const { blockBefore } = await import('../src/near.js');
	let calls = 0;
	const fetch = /** @type {typeof globalThis.fetch} */ (
		async (/** @type {any} */ _u, /** @type {any} */ init) => {
			calls++;
			if (calls === 1) return new Response('', { status: 429 });
			if (calls === 2) throw new TypeError('Failed to fetch'); // a 429 without CORS headers, as a browser sees it
			const { params } = JSON.parse(init.body);
			const h = params.finality ? 100 : Number(params.block_id);
			return new Response(
				JSON.stringify({
					jsonrpc: '2.0',
					id: 1,
					result: {
						header: {
							height: h,
							timestamp: String(BigInt(Date.parse('2026-11-01T00:00:00Z') + h * 1000) * 1_000_000n)
						}
					}
				})
			);
		}
	);
	const b = await blockBefore({ network: 'testnet', before: '2026-11-01T00:01:00Z', fetch });
	assert.equal(b.height, 59);
	assert.ok(calls > 2);
});
