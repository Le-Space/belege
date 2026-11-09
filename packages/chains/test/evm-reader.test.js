// SPDX-License-Identifier: AGPL-3.0-or-later
// Ethereum and Base as ledger entries through Alchemy, against the fake on
// 127.0.0.1: the gas to the network (a failed transaction's too), the key
// handed to each read and in no answer, the balances derived. All made up.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { evmReader } from '../src/evm.js';
import { CHAINS } from '../src/registry.js';
import { EVM } from './support/fake-blockscout.js';
import { FAKE_ALCHEMY_KEY, blockTime, startFakeAlchemy } from './support/fake-alchemy.js';

const ethereum = /** @type {import('../src/registry.js').EvmChain} */ (CHAINS.ethereum);
const base = /** @type {import('../src/registry.js').EvmChain} */ (CHAINS.base);
const day = (/** @type {number} */ block) =>
	new Date(blockTime(block) * 1000).toISOString().slice(0, 10);

/** @type {Awaited<ReturnType<typeof startFakeAlchemy>>} */ let alchemy;
before(async () => {
	alchemy = await startFakeAlchemy({ chainIds: { 'base-mainnet': 1 } });
});
after(() => alchemy?.close());

test('only an EVM chain Alchemy serves; the key is needed for every read', async () => {
	assert.throws(() => evmReader(/** @type {any} */ (CHAINS.bitcoin)), /no EVM chain/);
	const r = evmReader(ethereum, { baseUrl: alchemy.baseUrl });
	const p = { account: EVM.wallet, from: '2026-09-01', to: '2026-09-30' };
	await assert.rejects(r.read(p), /needs an Alchemy key/);
	await assert.rejects(r.read({ ...p, alchemyKey: 'not a key!' }), /needs an Alchemy key/);
	await assert.rejects(r.probe(), /needs an Alchemy key/);
	await assert.rejects(
		r.read({ ...p, account: 'wolkenfabrik.near', alchemyKey: FAKE_ALCHEMY_KEY }),
		/not an Ethereum address/
	);
	assert.ok(r.isAddress(EVM.wallet) && !r.isAddress('0x12'));
	assert.equal(
		r.canonical(EVM.wallet.toLowerCase()),
		r.canonical(EVM.wallet.toUpperCase().replace('0X', '0x'))
	);
});

test('the gas goes to the network, also a failed transaction’s; the tokens the chain lists are priced', async () => {
	const r = evmReader(ethereum, { baseUrl: alchemy.baseUrl });
	const entries = await r.read({
		account: EVM.wallet,
		from: '2020-01-01',
		to: '2030-12-31',
		alchemyKey: FAKE_ALCHEMY_KEY
	});
	assert.ok(entries.length > 5);
	assert.ok(
		entries.every(
			(e) => e.chain === 'ethereum' && e.network === 'mainnet' && e.account === EVM.wallet
		)
	);
	const fees = entries.filter((e) => e.type === 'fee');
	assert.ok(fees.length >= 3);
	assert.ok(
		fees.every(
			(f) =>
				f.counterparty === 'ethereum' &&
				f.counterpartyLabel === 'Ethereum-Netzwerk (Gas)' &&
				f.success === true &&
				f.priceAs === 'ETH'
		)
	);
	const usdcOut = entries.find((e) => e.asset === 'USDC' && e.amount === '-300');
	assert.deepEqual(
		[usdcOut?.priceAs, usdcOut?.counterparty, usdcOut?.kind],
		['USDC', EVM.exchange, 'transfer']
	);
	const spam = entries.filter((e) => e.priceAs === '' && e.type !== 'fee');
	assert.ok(
		spam.every((e) => e.contract !== 'native'),
		'an unlisted token keeps its contract and no price'
	);
	const first = day(100);
	const onDay = await r.read({
		account: EVM.wallet,
		from: first,
		to: first,
		alchemyKey: FAKE_ALCHEMY_KEY
	});
	assert.deepEqual(
		onDay.map((e) => e.id),
		entries.filter((e) => e.date === first).map((e) => e.id),
		'the period filters by day'
	);
	assert.ok(onDay.length > 0);
	assert.deepEqual(
		await r.read({
			account: EVM.wallet,
			from: '2026-08-01',
			to: '2026-08-31',
			alchemyKey: FAKE_ALCHEMY_KEY
		}),
		[]
	);
	assert.ok(!JSON.stringify(entries).includes(FAKE_ALCHEMY_KEY), 'the key is in no entry');
});

test('a statement: balances derived from today’s less the movements since', async () => {
	const r = evmReader(ethereum, { baseUrl: alchemy.baseUrl });
	const st = await r.statement({
		account: EVM.wallet,
		from: '2020-01-01',
		to: '2030-12-31',
		alchemyKey: FAKE_ALCHEMY_KEY
	});
	assert.equal(st.method, 'derived');
	assert.deepEqual([st.closing.ETH, st.closing.USDC], ['0.31', '450'], 'the fake’s balances now');
	assert.equal(
		st.entries.length,
		(
			await r.read({
				account: EVM.wallet,
				from: '2020-01-01',
				to: '2030-12-31',
				alchemyKey: FAKE_ALCHEMY_KEY
			})
		).length
	);
	const none = await r.statement({
		account: EVM.wallet,
		from: '2031-01-01',
		to: '2031-01-31',
		alchemyKey: FAKE_ALCHEMY_KEY
	});
	assert.deepEqual([none.entries.length, none.opening.ETH], [0, '0.31']);
});

test('the live check: Alchemy must serve the chain itself, and the answer carries no key', async () => {
	const ok = await evmReader(ethereum, { baseUrl: alchemy.baseUrl }).probe({
		alchemyKey: FAKE_ALCHEMY_KEY
	});
	assert.deepEqual(ok, { sample: 'eth-mainnet eth_chainId', entries: 1 });
	assert.ok(!JSON.stringify(ok).includes(FAKE_ALCHEMY_KEY));
	// The fake answers chain id 1 for base-mainnet here.
	await assert.rejects(
		evmReader(base, { baseUrl: alchemy.baseUrl }).probe({ alchemyKey: FAKE_ALCHEMY_KEY }),
		/does not serve Base/
	);
});
