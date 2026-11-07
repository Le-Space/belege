// SPDX-License-Identifier: AGPL-3.0-or-later
// The fakes other packages test against (@le-space/chains/testing/*), by
// their published names: a made-up EVM wallet read through the fake Alchemy
// and the fake Blockscout gives the same entries; the fake Aleph API gives
// a month's statement. Every address, hash, key and amount is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CHAINS } from '@le-space/chains/registry';
import { createEvmClient } from '@le-space/chains/evm';
import { createAlephClient } from '@le-space/chains/aleph';
import {
	FAKE_ALCHEMY_KEY,
	blockscoutView,
	evmChain,
	startFakeAlchemy
} from '@le-space/chains/testing/alchemy';
import { EVM, startFakeBlockscout } from '@le-space/chains/testing/blockscout';
import {
	ACCOUNT,
	alephFetch,
	flatUsd,
	sampleBalance,
	sampleRows
} from '@le-space/chains/testing/aleph';

const ethereum = /** @type {import('@le-space/chains/registry').EvmChain} */ (CHAINS.ethereum);

test('testing/alchemy and testing/blockscout serve the same made-up wallet', async () => {
	const txs = evmChain();
	const alchemy = await startFakeAlchemy({ txs });
	const scout = await startFakeBlockscout({ history: blockscoutView(txs) });
	try {
		const client = (/** @type {string | null} */ key) =>
			createEvmClient({
				sleep: async () => {},
				alchemy: { key: async () => key, baseUrl: alchemy.baseUrl }
			});
		const viaAlchemy = await client(FAKE_ALCHEMY_KEY).history({
			chain: ethereum,
			address: EVM.wallet,
			endpoints: ethereum.endpoints
		});
		const viaScout = await client(null).history({
			chain: ethereum,
			address: EVM.wallet,
			endpoints: scout.endpoints
		});
		assert.equal(viaAlchemy.source, 'alchemy');
		assert.equal(viaScout.source, 'blockscout');
		const shape = (/** @type {typeof viaAlchemy.entries} */ entries) =>
			entries
				.filter((e) => !e.id.includes(':internal:'))
				.map((e) => `${e.id} ${e.amount} ${e.success}`)
				.sort();
		assert.ok(viaAlchemy.entries.length > 5);
		assert.deepEqual(shape(viaAlchemy.entries), shape(viaScout.entries));
	} finally {
		await alchemy.close();
		await scout.close();
	}
});

test('testing/aleph: a fake Aleph API and a made-up month', async () => {
	const aleph = createAlephClient({
		fetch: alephFetch({
			accounts: { [ACCOUNT]: { balance: sampleBalance(), rows: sampleRows() } }
		}),
		sleep: async () => {},
		rates: flatUsd,
		now: () => new Date('2026-09-10T00:00:00Z')
	});
	const s = await aleph.statement({ address: ACCOUNT, month: '2026-08' });
	assert.equal(s.opening, 3_000_000);
	assert.equal(s.difference, 0);
});

test('package.json ships every testing/* module', async () => {
	const { readFile } = await import('node:fs/promises');
	const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const testing = Object.entries(pkg.exports).filter(([k]) => k.startsWith('./testing/'));
	assert.ok(testing.length >= 5);
	for (const [, path] of testing)
		assert.ok(
			pkg.files.some((/** @type {string} */ f) => path.startsWith(`./${f}/`)),
			`${path} is not in files`
		);
});
