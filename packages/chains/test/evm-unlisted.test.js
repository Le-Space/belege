// SPDX-License-Identifier: AGPL-3.0-or-later
// Every token an Ethereum address moved, as its own statement section (#93):
// an unlisted token the wallet sent on is booked by its contract and gets its
// balance read; an airdrop it never touched stays out unless named; a token
// calling itself USDC never comes in. Made-up addresses, tokens and amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evmReader } from '../src/evm.js';
import { CHAINS } from '../src/registry.js';
import { FAKE_ALCHEMY_KEY } from './support/fake-alchemy.js';
import {
	DROP,
	FAKE_USDC,
	POISON,
	TOKENS_WALLET,
	XYZ,
	fakeAlchemyFetch
} from './support/fake-alchemy-fetch.js';

const ethereum = /** @type {import('../src/registry.js').EvmChain} */ (CHAINS.ethereum);
const USDC = Object.keys(ethereum.tokens).find((c) => ethereum.tokens[c].symbol === 'USDC');
const reader = evmReader(ethereum, { baseUrl: () => 'https://alchemy.example/v2' });
const period = { account: TOKENS_WALLET, from: '2026-10-01', to: '2026-10-31' };

test('an unlisted token the wallet sent on: booked by its contract, its balance read, a section of its own', async () => {
	const fake = fakeAlchemyFetch();
	const st = await reader.statement({ ...period, alchemyKey: FAKE_ALCHEMY_KEY, fetch: fake.fetch });

	const xyz = st.entries.filter((e) => e.asset === 'XYZ');
	assert.deepEqual(
		xyz.map((e) => [e.type, e.amount, e.contract, e.listed, e.priceAs]),
		[
			['received', '300', XYZ, false, ''],
			['sent', '-100', XYZ, false, '']
		],
		'both directions booked, by the contract, without a price of the list'
	);
	assert.deepEqual(
		[st.opening.XYZ, st.closing.XYZ],
		['0', '200'],
		'opening and closing derived from its balance now'
	);
	assert.deepEqual(
		Object.keys(st.closing),
		['ETH', 'USDC', 'ALEPH', 'XYZ'],
		'native, listed, unlisted'
	);

	assert.ok(!st.entries.some((e) => e.asset === 'DROP'), 'an airdrop never touched stays out');
	assert.ok(!('DROP' in st.closing));
	assert.deepEqual(st.contracts, { XYZ }, 'only unlisted tokens, by their contract');
	assert.ok(
		!st.entries.some((e) => e.contract === FAKE_USDC) && st.closing.USDC === '0',
		'a token calling itself USDC is not USDC'
	);
	const asked = fake.asked.flat();
	assert.ok(asked.includes(XYZ) && asked.includes(USDC));
	assert.ok(
		!asked.includes(DROP) && !asked.includes(FAKE_USDC),
		'no balance read for tokens left out'
	);
});

test('a contract the caller names is booked although only received; a lookalike stays out all the same', async () => {
	const fake = fakeAlchemyFetch();
	const st = await reader.statement({
		...period,
		alchemyKey: FAKE_ALCHEMY_KEY,
		fetch: fake.fetch,
		tokens: [DROP.toUpperCase().replace('0X', '0x'), FAKE_USDC, 'not a contract']
	});
	assert.deepEqual(
		st.entries.filter((e) => e.asset === 'DROP').map((e) => [e.amount, e.contract]),
		[['5', DROP]]
	);
	assert.deepEqual([st.opening.DROP, st.closing.DROP], ['0', '5']);
	assert.deepEqual(st.contracts, { XYZ, DROP }, 'the contract of each unlisted balance');
	assert.deepEqual(
		Object.keys(st.closing),
		['ETH', 'USDC', 'ALEPH', 'XYZ', 'DROP'],
		'the unlisted ones ordered by contract (0x5e… before 0xd7…)'
	);
	assert.ok(!st.entries.some((e) => e.contract === FAKE_USDC));
	assert.ok(!Object.values(st.closing).includes('9'), 'the fake USDC has no section');
});

test('the gas of the wallet’s own transaction is booked; ETH reconciles', async () => {
	const fake = fakeAlchemyFetch();
	const st = await reader.statement({ ...period, alchemyKey: FAKE_ALCHEMY_KEY, fetch: fake.fetch });
	const fees = st.entries.filter((e) => e.type === 'fee');
	assert.deepEqual(
		fees.map((e) => e.amount),
		['-0.00012']
	);
	assert.deepEqual([st.opening.ETH, st.closing.ETH], ['0', '0.49988']);
});

test('a token without a booking in the period keeps its contract in the answer', async () => {
	const fake = fakeAlchemyFetch();
	// The XYZ movements are in October; November has none of them.
	const st = await reader.statement({
		account: TOKENS_WALLET,
		from: '2026-11-01',
		to: '2026-11-30',
		alchemyKey: FAKE_ALCHEMY_KEY,
		fetch: fake.fetch
	});
	assert.ok(!st.entries.some((e) => e.asset === 'XYZ'));
	assert.deepEqual([st.opening.XYZ, st.closing.XYZ], ['200', '200']);
	assert.deepEqual(st.contracts, { XYZ });
});

test('a transfer a spam contract emits "from" the wallet, in a transaction someone else sent, is not the wallet’s', async () => {
	const fake = fakeAlchemyFetch();
	const st = await reader.statement({ ...period, alchemyKey: FAKE_ALCHEMY_KEY, fetch: fake.fetch });
	assert.ok(!st.entries.some((e) => e.contract === POISON), 'no entry of the poisoning token');
	assert.ok(!('ERC' in st.closing) && !('ERC' in st.contracts), 'no section, no contract');
	assert.ok(!fake.asked.flat().includes(POISON), 'its balance is not asked for');
	assert.deepEqual(
		[st.opening.ETH, st.closing.ETH],
		['0', '0.49988'],
		'the wallet paid no gas for it'
	);
	// Named by the caller, it is on the statement all the same: the caller's choice.
	const named = await reader.statement({
		...period,
		alchemyKey: FAKE_ALCHEMY_KEY,
		fetch: fakeAlchemyFetch().fetch,
		tokens: [POISON]
	});
	assert.deepEqual(
		named.entries.filter((e) => e.contract === POISON).map((e) => e.amount),
		['-1400']
	);
});
