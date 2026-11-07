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
