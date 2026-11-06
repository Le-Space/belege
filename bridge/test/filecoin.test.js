// Filecoin in the bridge: the reader is in @le-space/chains (its own tests
// are there, #264); here that the wallet service lists it and reads through it.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';

import { createWalletService } from '@le-space/chains';
import { fakeFilecoinAddress, startFakeFilfox } from './support/fake-filfox.js';

const OURS = fakeFilecoinAddress('own wallet');

/** @type {Awaited<ReturnType<typeof startFakeFilfox>>} */
let filfox;
before(async () => {
	filfox = await startFakeFilfox({ addresses: { [OURS]: { balance: '0', transfers: [] } } });
});
after(async () => filfox?.close());

test('GET /chains names Filecoin with its explorer, and Filfox as its default API', () => {
	const service = createWalletService();
	const fil = service.chains().find((c) => c.id === 'filecoin');
	assert.deepEqual(
		{ kind: fil?.kind, assets: fil?.assets, native: fil?.nativeSymbol, api: fil?.endpoints.api },
		{ kind: 'filecoin', assets: ['FIL', 'USDFC'], native: 'FIL', api: 'https://filfox.info/api/v1' }
	);
});

test('the wallet service reads a Filecoin wallet through the package; a bad address is refused', async () => {
	const service = createWalletService({ allowLoopback: true, sleep: async () => {} });
	const result = await service.sync({
		chain: 'filecoin',
		address: ` ${OURS} `,
		endpoints: { api: filfox.url }
	});
	assert.deepEqual(result.entries, []);
	assert.equal(result.addressUrl, `https://filfox.info/en/address/${OURS}`);
	await assert.rejects(
		service.sync({ chain: 'filecoin', address: 'f1nichtgueltig', endpoints: { api: filfox.url } }),
		(/** @type {any} */ e) => e.code === 'WALLET_ADDRESS'
	);
});
