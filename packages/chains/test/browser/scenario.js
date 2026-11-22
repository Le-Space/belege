// SPDX-License-Identifier: AGPL-3.0-or-later
// The chain readers in a browser: every place that used Node's Buffer or
// node:crypto before the move, a NEAR read (a fixture of public data) and an
// Aleph credit statement, each through a fetch that is handed in.
// browser.test.js runs this in Node and in Chromium and compares. Made-up keys and addresses otherwise.
import { HDKey } from '@scure/bip32';

import {
	decodeTx,
	deriveAddress,
	encodeTx,
	isCosmosAddress,
	keyFingerprint,
	moduleAddress,
	parseExtendedKey,
	readEvents,
	toChecksumAddress,
	toFilecoinAddress
} from '../../src/index.js';
import { fetchRaw, mapRaw } from '../../src/near.js';
import { alephEntries, createAlephClient } from '../../src/aleph.js';
import { alephFetch } from '../support/aleph-fetch.js';
import { statementBitcoin } from '../../src/bitcoin-address.js';
import { btcTx, fakeBitcoinAddress, fakeEsplora } from '../support/fake-esplora.js';
import { ACCOUNT, VM, flatUsd, sampleBalance, sampleRows } from '../support/aleph-sample.js';
import day from '../fixtures/relay-aurora-2026-11-01.json' with { type: 'json' };
import { evmReader } from '../../src/evm.js';
import { CHAINS } from '../../src/registry.js';
import { TOKENS_WALLET, fakeAlchemyFetch } from '../support/fake-alchemy-fetch.js';

/** A fetch that answers NearBlocks' two lists from the fixture, one page each. */
/** @type {typeof fetch} */
const nearBlocks = async (input) => {
	const url = new URL(String(input));
	const rows = url.pathname.endsWith('/ft-txns') ? day.ftTxns : day.txns;
	return new Response(JSON.stringify({ data: rows, meta: {} }), {
		headers: { 'content-type': 'application/json' }
	});
};

const b64 = (/** @type {string} */ s) => btoa(s);

export default async function scenario() {
	const seed = Uint8Array.from({ length: 64 }, (_, i) => i);
	const zpub = HDKey.fromMasterSeed(seed, { private: 0x04b2430c, public: 0x04b24746 }).derive(
		"m/84'/0'/0'"
	).publicExtendedKey;
	const z = parseExtendedKey(zpub);
	const tx = encodeTx({
		memo: 'Rechnung 2026-001 Wolkenfabrik',
		messageTypes: ['/cosmos.bank.v1beta1.MsgSend'],
		fee: [{ denom: 'uakt', amount: '5000' }]
	});
	const raw = await fetchRaw({
		account: day.account,
		network: 'mainnet',
		from: '2026-11-01',
		to: '2026-11-01',
		fetch: nearBlocks,
		maxPages: 1,
		partial: true,
		endpoints: { api: 'https://nearblocks.example' }
	});
	const near = mapRaw({ ...raw, explorer: 'https://explorer.example/txns/' });
	const aleph = await createAlephClient({
		fetch: alephFetch({
			accounts: { [ACCOUNT]: { balance: sampleBalance(), rows: sampleRows() } },
			messages: { [VM]: { type: 'INSTANCE', name: 'test-relay' } }
		}),
		sleep: async () => {},
		rates: flatUsd,
		now: () => new Date('2026-09-10T00:00:00Z')
	}).statement({ address: ACCOUNT, month: '2026-08' });
	const own = fakeBitcoinAddress('own address');
	const esplora = fakeEsplora({
		txs: [btcTx('paid', 300, [[fakeBitcoinAddress('a customer'), 20_000]], [[own, 10_000]])]
	});
	const bitcoin = await statementBitcoin({
		account: own,
		from: '2026-01-01',
		to: '2027-12-31',
		fetch: esplora.fetch,
		endpoints: { api: esplora.url },
		sleep: async () => {}
	});
	// The same wallet by its zpub: the addresses derived in the browser.
	const walletEsplora = fakeEsplora({
		txs: [
			btcTx(
				'paid the wallet',
				300,
				[[fakeBitcoinAddress('a customer'), 20_000]],
				[[deriveAddress(z.account, z.type, 0, 2), 10_000]]
			)
		]
	});
	const btcWallet = await statementBitcoin({
		account: zpub,
		from: '2026-01-01',
		to: '2027-12-31',
		fetch: walletEsplora.fetch,
		endpoints: { api: walletEsplora.url },
		sleep: async () => {}
	});
	// Ethereum through a fake Alchemy: an unlisted token the wallet sent on gets its section (#93).
	const evm = await evmReader(
		/** @type {import('../../src/registry.js').EvmChain} */ (CHAINS.ethereum),
		{ baseUrl: () => 'https://alchemy.example/v2' }
	).statement({
		account: TOKENS_WALLET,
		from: '2026-10-01',
		to: '2026-10-31',
		alchemyKey: 'fakeAlchemyKey_0123456789abcdef',
		fetch: fakeAlchemyFetch().fetch
	});
	return {
		evm: { closing: evm.closing, entries: evm.entries.length },
		aleph: { statement: aleph, entries: alephEntries(aleph) },
		btcWallet: {
			closing: btcWallet.closing.BTC,
			entries: btcWallet.entries.length,
			account: btcWallet.entries[0]?.account === keyFingerprint(zpub)
		},
		bitcoin: { closing: bitcoin.closing.BTC, entries: bitcoin.entries.length },
		feeCollector: moduleAddress('akash', 'fee_collector'),
		isCosmos: isCosmosAddress(moduleAddress('n', 'distribution'), 'n'),
		tx: decodeTx(tx),
		events: readEvents([
			{ type: 'transfer', attributes: [{ key: b64('recipient'), value: b64('akash1example') }] }
		]),
		f410f: toFilecoinAddress(`0x${'ab'.repeat(20)}`),
		checksum: toChecksumAddress(`0x${'ab'.repeat(20)}`),
		btc: [keyFingerprint(zpub), deriveAddress(z.account, z.type, 0, 0)],
		near: {
			count: near.length,
			first: near[0],
			explorer: near.every((e) => e.explorerUrl.startsWith('https://explorer.example/txns/'))
		}
	};
}
