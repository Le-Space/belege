// SPDX-License-Identifier: AGPL-3.0-or-later
// What a browser app ships when it imports one module: Aleph's statement
// needs an EVM address's checksum, not the EVM reader, Alchemy or every
// chain's data. Not shaken: the modules it pulls in, whole, as a dev server
// or a bundler that cannot drop unused code loads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleForBrowser } from '@le-space/browser-test';

test('@le-space/chains/aleph bundles for a browser without Alchemy or the registry', async () => {
	const code = await bundleForBrowser([import.meta.resolve('@le-space/chains/aleph')], {
		treeshake: false
	});
	assert.match(code, /credit_history/);
	assert.doesNotMatch(code, /alchemy\.com/i);
	assert.doesNotMatch(code, /blockscout/i);
});

test('@le-space/chains/evm-address is keccak and bytes only', async () => {
	const code = await bundleForBrowser([import.meta.resolve('@le-space/chains/evm-address')], {
		treeshake: false
	});
	assert.match(code, /function toChecksumAddress/);
	assert.doesNotMatch(code, /alchemy\.com|blockscout|filfox/i);
});

test('@le-space/chains/filecoin-chain carries Filecoin only', async () => {
	const code = await bundleForBrowser([import.meta.resolve('@le-space/chains/filecoin-chain')], {
		treeshake: false
	});
	assert.match(code, /filfox\.info/);
	assert.doesNotMatch(code, /blockscout|mempool\.space|xmrchain/i);
});

// The readers take their chain as an argument; only registry.js (every
// chain, Monero's explorer among them) and wallets.js need the whole table.
for (const reader of ['evm', 'bitcoin', 'filecoin', 'cosmos', 'near', 'evm-contracts']) {
	test(`@le-space/chains/${reader} does not bundle the registry`, async () => {
		const code = await bundleForBrowser([import.meta.resolve(`@le-space/chains/${reader}`)], {
			treeshake: false
		});
		assert.doesNotMatch(code, /xmrchain/);
	});
}
