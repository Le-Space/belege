// SPDX-License-Identifier: AGPL-3.0-or-later
// The chain readers in a browser: every place that used Node's Buffer or
// node:crypto before the move, and a NEAR read through a fetch that is handed
// in (served from a fixture of public data). browser.test.js runs this in
// Node and in Chromium and compares. Made-up keys and addresses otherwise.
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
import day from '../fixtures/relay-aurora-2026-11-01.json' with { type: 'json' };

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
	return {
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
