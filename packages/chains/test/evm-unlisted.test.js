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
