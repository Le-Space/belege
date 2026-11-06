// Fake chain nodes on 127.0.0.1 for tests: a Blockscout (the
// Etherscan-compatible `/api`) here, and the Cosmos node and the Akash Console
// indexer from @belege/chain-cosmos/testing (re-exported, #264). Every
// address, hash and amount here is made up: addresses are derived from test
// phrases, hashes from counters.
import http from 'node:http';
import { createHash } from 'node:crypto';

import { fakeHash } from '@belege/chain-cosmos/testing';

export * from '@belege/chain-cosmos/testing';

/** A synthetic EVM address, lower case. */
export const fakeEvmAddress = (/** @type {string} */ phrase) =>
	`0x${createHash('sha256').update(`belege test ${phrase}`).digest('hex').slice(0, 40)}`;

export const EVM = {
	wallet: fakeEvmAddress('evm wallet'),
	exchange: fakeEvmAddress('exchange deposit address'),
	friend: fakeEvmAddress('someone else on evm'),
	contract: fakeEvmAddress('a contract'),
	usdc: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
	spamToken: fakeEvmAddress('a token calling itself USDC')
};

const evmTime = (/** @type {number} */ block) =>
	String(Math.floor(Date.parse('2026-09-01T00:00:00Z') / 1000) + (block - 100) * 12);

/**
 * A made-up history of EVM.wallet on Ethereum: ETH in, USDC in and out to
 * the exchange, a failed send, ETH from a contract, a spam token.
 */
export function sampleEvmHistory({ fillerTokens = 0 } = {}) {
	const w = EVM.wallet;
	const tx = (
		/** @type {string} */ seed,
		/** @type {number} */ block,
		/** @type {Record<string, string>} */ fields
	) => ({
		blockNumber: String(block),
		timeStamp: evmTime(block),
		hash: fakeHash(seed, true),
		transactionIndex: '0',
		gas: '60000',
		...fields
	});
	const normal = [
		tx('eth-in', 100, {
			from: EVM.friend,
			to: w,
			value: '500000000000000000',
			gasUsed: '21000',
			gasPrice: '1000000000',
			isError: '0',
			txreceipt_status: '1'
		}),
		// USDC to the exchange: the token moves in tokentx; here only the gas.
		tx('usdc-out', 200, {
			from: w,
			to: EVM.usdc,
			value: '0',
			gasUsed: '50000',
			gasPrice: '2000000000',
			isError: '0',
			txreceipt_status: '1'
		}),
		tx('failed', 300, {
			from: w,
			to: EVM.friend,
			value: '100000000000000000',
			gasUsed: '21000',
			gasPrice: '3000000000',
			isError: '1',
			txreceipt_status: '0'
		}),
		tx('eth-out', 400, {
			from: w,
			to: EVM.friend,
			value: '100000000000000000',
			gasUsed: '21000',
			gasPrice: '1000000000',
			isError: '0',
			txreceipt_status: '1'
		})
	];
	const internal = [
		{
			blockNumber: '500',
			timeStamp: evmTime(500),
			transactionHash: fakeHash('contract-pays', true),
			index: '1',
			from: EVM.contract,
			to: w,
			value: '20000000000000000',
			isError: '0',
			type: 'call'
		}
	];
	const tokens = [
		tx('usdc-in', 150, {
			from: EVM.friend,
			to: w,
			value: '750000000',
			contractAddress: EVM.usdc,
			tokenSymbol: 'USDC',
			tokenDecimal: '6'
		}),
		tx('usdc-out', 200, {
			from: w,
			to: EVM.exchange,
			value: '300000000',
			contractAddress: EVM.usdc,
			tokenSymbol: 'USDC',
			tokenDecimal: '6'
		}),
		tx('spam', 250, {
			from: EVM.friend,
			to: w,
			value: '1000000000000',
			contractAddress: EVM.spamToken,
			tokenSymbol: 'USDC',
			tokenDecimal: '6'
		})
	];
	for (let i = 0; i < fillerTokens; i++) {
		tokens.push(
			tx(`filler-${i}`, 1000 + Math.floor(i / 3), {
				from: EVM.friend,
				to: w,
				value: '1',
				contractAddress: EVM.usdc,
				tokenSymbol: 'USDC',
				tokenDecimal: '6'
			})
		);
	}
	return { normal, internal, tokens };
}

/**
 * @param {object} [options]
 * @param {{ normal: Record<string, string>[], internal: Record<string, string>[], tokens: Record<string, string>[] }} [options.history]
 *   as sampleEvmHistory, or fake-alchemy.js's blockscoutView
 * @param {Record<string, string>} [options.balances] `native` and contract → units
 * @param {number} [options.rateLimitedCalls] this many answer Blockscout's "rate limit" first
 * @param {number} [options.maxOffset] page × offset beyond this is refused, as Blockscout does
 * @param {string | null} [options.chainId] what `…/api/eth-rpc` answers to eth_chainId; null: 404
 * @param {{ block_number: number, block_timestamp: string, value: string }[] | null} [options.coinBalanceHistory]
 *   `…/api/v2/addresses/<a>/coin-balance-history`, newest first; null: 404
 */
export async function startFakeBlockscout({
	history = sampleEvmHistory(),
	balances = { native: '310000000000000000', [EVM.usdc]: '450000000' },
	rateLimitedCalls = 0,
	maxOffset = 10_000,
	chainId = '0x1',
	// The native coin's balance after each change (#287), newest first as Blockscout gives it;
	// null: the v2 endpoint is not there.
	coinBalanceHistory = [
		{
			block_number: 19_500_000,
			block_timestamp: '2026-03-20T09:00:00.000000Z',
			value: '310000000000000000'
		},
		{
			block_number: 19_400_000,
			block_timestamp: '2026-02-10T12:00:00.000000Z',
			value: '500000000000000000'
		}
	]
} = {}) {
	/** @type {Record<string, string>[]} */
	const calls = [];
	let limited = rateLimitedCalls;
	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		if (url.pathname === '/api/eth-rpc' && req.method === 'POST') {
			let raw = '';
			req.on('data', (c) => (raw += c));
			req.on('end', () => {
				calls.push({ rpc: JSON.parse(raw).method });
				if (chainId === null) {
					res.writeHead(404, { 'Content-Type': 'application/json' });
					return res.end(JSON.stringify({ message: 'Not found' }));
				}
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: chainId }));
			});
			return;
		}
		const reply = (/** @type {unknown} */ body) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const v2 = /^\/api\/v2\/addresses\/(0x[0-9a-f]{40})\/coin-balance-history$/.exec(url.pathname);
		if (v2) {
			calls.push({
				v2: 'coin-balance-history',
				address: v2[1],
				...Object.fromEntries(url.searchParams)
			});
			if (coinBalanceHistory === null) {
				res.writeHead(404, { 'Content-Type': 'application/json' });
				return res.end(JSON.stringify({ message: 'Not found' }));
			}
			// One item a page, to prove the paging.
			const from = Number(url.searchParams.get('n') ?? 0);
			const item = coinBalanceHistory[from];
			return reply({
				items: item ? [item] : [],
				next_page_params: from + 1 < coinBalanceHistory.length ? { n: from + 1 } : null
			});
		}
		const p = Object.fromEntries(url.searchParams);
		calls.push(p);
		if (url.pathname !== '/api')
			return reply({ status: '0', message: 'Unknown path', result: null });
		if (limited > 0) {
			limited--;
			return reply({ status: '0', message: 'NOTOK', result: 'Max rate limit reached' });
		}
		if (!/^0x[0-9a-f]{40}$/.test(p.address ?? '')) {
			return reply({ status: '0', message: 'Invalid address format', result: null });
		}
		if (p.action === 'balance')
			return reply({ status: '1', message: 'OK', result: balances.native ?? '0' });
		if (p.action === 'tokenbalance') {
			return reply({
				status: '1',
				message: 'OK',
				result: balances[String(p.contractaddress).toLowerCase()] ?? '0'
			});
		}
		const lists = /** @type {Record<string, any[]>} */ ({
			txlist: history.normal,
			txlistinternal: history.internal,
			tokentx: history.tokens
		});
		const list = lists[p.action];
		if (!list) return reply({ status: '0', message: 'Unknown action', result: null });
		const page = Number(p.page ?? 1);
		const offset = Number(p.offset ?? 10);
		if (page * offset > maxOffset) {
			return reply({
				status: '0',
				message: `Result window is too large, PageNo x Offset size must be less than or equal to ${maxOffset}`,
				result: null
			});
		}
		const start = Number(p.startblock ?? 0);
		const mine = list
			.filter((r) => [r.from, r.to].includes(p.address) && Number(r.blockNumber) >= start)
			.sort((a, b) => Number(a.blockNumber) - Number(b.blockNumber));
		const slice = mine.slice((page - 1) * offset, page * offset);
		// Blockscout's tokentx carries no logIndex.
		const shaped = slice.map(({ logIndex: _l, ...r }) => r);
		if (!shaped.length) {
			return reply({
				status: '0',
				message: p.action === 'tokentx' ? 'No token transfers found' : 'No transactions found',
				result: []
			});
		}
		return reply({ status: '1', message: 'OK', result: shaped });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	const url = `http://127.0.0.1:${port}`;
	return {
		url,
		endpoints: { api: `${url}/api` },
		calls,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}
