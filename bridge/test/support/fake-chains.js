// Fake chain nodes on 127.0.0.1 for tests: a Cosmos node (CometBFT JSON-RPC
// `status`, `tx_search`, `header`, and the REST balance) and a Blockscout
// (the Etherscan-compatible `/api`). Every address, hash and amount here is
// made up: addresses are derived from test phrases, hashes from counters.
import http from 'node:http';
import { createHash } from 'node:crypto';

import { bech32Encode, moduleAddress } from '../../src/chains/bech32.js';
import { encodeTx } from '../../src/chains/protobuf.js';

/** A synthetic bech32 address: the first 20 bytes of SHA-256 of a phrase. */
export const fakeCosmosAddress = (/** @type {string} */ phrase, prefix = 'n') =>
	bech32Encode(
		prefix,
		createHash('sha256').update(`belege test ${phrase}`).digest().subarray(0, 20)
	);

/** A synthetic EVM address, lower case. */
export const fakeEvmAddress = (/** @type {string} */ phrase) =>
	`0x${createHash('sha256').update(`belege test ${phrase}`).digest('hex').slice(0, 40)}`;

/** A synthetic 32-byte hash, upper-case hex (Cosmos) or 0x-lower (EVM). */
export const fakeHash = (/** @type {string} */ seed, evm = false) => {
	const hex = createHash('sha256').update(`belege test tx ${seed}`).digest('hex');
	return evm ? `0x${hex}` : hex.toUpperCase();
};

/** The addresses the samples use. */
export const NYX = {
	wallet: fakeCosmosAddress('wallet'),
	exchange: fakeCosmosAddress('exchange hot wallet'),
	friend: fakeCosmosAddress('someone else'),
	feeCollector: moduleAddress('n', 'fee_collector'),
	distribution: moduleAddress('n', 'distribution'),
	bonded: moduleAddress('n', 'bonded_tokens_pool')
};

/**
 * One transaction as tx_search hands it out (cosmos-sdk 0.53, CometBFT 0.38).
 *
 * @param {object} t
 * @param {string} t.seed makes the hash
 * @param {number} t.height
 * @param {number} [t.code] 0 = success
 * @param {string} [t.memo]
 * @param {{ payer: string, amount: string } | null} [t.fee] e.g. { payer, amount: '5000unym' }
 * @param {{ sender: string, recipient: string, amount: string }[]} [t.transfers] one per message
 * @param {string} [t.ibcReceiver] an IBC transfer's receiver on the other chain
 * @param {boolean} [t.legacyEvents] cosmos-sdk < 0.47 with CometBFT 0.34: one transfer
 *   event holding every triple, base64 keys and values, no fee event
 * @param {string} [t.prefix] the chain's bech32 prefix, for its fee collector
 */
export function cosmosTx({
	seed,
	height,
	code = 0,
	memo = '',
	fee = null,
	transfers = [],
	ibcReceiver,
	legacyEvents = false,
	prefix = 'n'
}) {
	/** @type {{ type: string, attributes: { key: string, value: string, index?: boolean }[] }[]} */
	const events = [];
	const attr = (/** @type {string} */ key, /** @type {string} */ value) => ({
		key,
		value,
		index: true
	});
	if (fee) {
		events.push({
			type: 'transfer',
			attributes: [
				attr('recipient', moduleAddress(prefix, 'fee_collector')),
				attr('sender', fee.payer),
				attr('amount', fee.amount)
			]
		});
		if (!legacyEvents) {
			events.push({
				type: 'tx',
				attributes: [attr('fee', fee.amount), attr('fee_payer', fee.payer)]
			});
		}
	}
	if (code === 0) {
		if (legacyEvents && transfers.length) {
			events.push({
				type: 'transfer',
				attributes: transfers.flatMap((t) => [
					attr('recipient', t.recipient),
					attr('sender', t.sender),
					attr('amount', t.amount)
				])
			});
		} else {
			transfers.forEach((t, i) => {
				events.push({
					type: 'message',
					attributes: [attr('sender', t.sender), attr('msg_index', String(i))]
				});
				events.push({
					type: 'transfer',
					attributes: [
						attr('recipient', t.recipient),
						attr('sender', t.sender),
						attr('amount', t.amount),
						attr('msg_index', String(i))
					]
				});
			});
		}
		if (ibcReceiver) {
			events.push({ type: 'ibc_transfer', attributes: [attr('receiver', ibcReceiver)] });
		}
	}
	const b64 = (/** @type {string} */ s) => Buffer.from(s).toString('base64');
	return {
		hash: fakeHash(seed),
		height: String(height),
		index: 0,
		tx: encodeTx({
			memo,
			messageTypes: transfers.map(() => '/cosmos.bank.v1beta1.MsgSend'),
			fee: fee
				? [{ denom: fee.amount.replace(/^\d+/, ''), amount: fee.amount.match(/^\d+/)?.[0] ?? '0' }]
				: []
		}),
		tx_result: {
			code,
			log: code ? 'out of gas' : '',
			events: legacyEvents
				? events.map((e) => ({
						type: e.type,
						attributes: e.attributes.map((a) => ({ key: b64(a.key), value: b64(a.value) }))
					}))
				: events
		}
	};
}

/** Block heights → times: one block a minute from a made-up start. */
export const blockTime = (/** @type {number} */ height) =>
	new Date(Date.parse('2026-09-01T00:00:00Z') + (height - 1000) * 60_000).toISOString();

/**
 * A made-up history of NYX.wallet: bought on an exchange and withdrawn to
 * the wallet, sent on, a failed send, a delegation with its reward, an IBC
 * voucher, a multi-message send, a transaction from the old event format,
 * and many small incoming ones, so tx_search needs more than one page.
 *
 * @param {object} [options]
 * @param {number} [options.filler] how many small incoming ones
 * @param {(height: number) => string} [options.time]
 */
export function sampleNyxHistory({ filler = 110 } = {}) {
	const w = NYX.wallet;
	const fee = (/** @type {string} */ amount) => ({ payer: w, amount });
	const txs = [
		// The exchange withdraws 250 NYM to the wallet; the exchange pays the fee.
		cosmosTx({
			seed: 'withdrawal',
			height: 1000,
			memo: 'Test-Memo Auszahlung',
			fee: { payer: NYX.exchange, amount: '4000unym' },
			transfers: [{ sender: NYX.exchange, recipient: w, amount: '250000000unym' }]
		}),
		// The wallet sends 12.5 NYM to someone and pays 5000 unym fee.
		cosmosTx({
			seed: 'send',
			height: 2000,
			memo: 'Rechnung Test 1',
			fee: fee('5000unym'),
			transfers: [{ sender: w, recipient: NYX.friend, amount: '12500000unym' }]
		}),
		// A failed send: only the fee leaves.
		cosmosTx({
			seed: 'failed',
			height: 2100,
			code: 5,
			fee: fee('3000unym'),
			transfers: [{ sender: w, recipient: NYX.friend, amount: '999000000unym' }]
		}),
		// A delegation, with the rewards withdrawn in the same transaction.
		cosmosTx({
			seed: 'delegate',
			height: 2200,
			fee: fee('6000unym'),
			transfers: [
				{ sender: NYX.distribution, recipient: w, amount: '1234567unym' },
				{ sender: w, recipient: NYX.bonded, amount: '100000000unym' }
			]
		}),
		// An IBC voucher arrives next to NYX: the voucher is not booked.
		cosmosTx({
			seed: 'ibc-in',
			height: 2300,
			fee: { payer: NYX.friend, amount: '2000unym' },
			transfers: [
				{ sender: NYX.friend, recipient: w, amount: '7000000ibc/ABCDEF0123456789,2000000unyx' }
			]
		}),
		// Two sends in one transaction.
		cosmosTx({
			seed: 'multi',
			height: 2400,
			memo: 'Zwei Empfänger',
			fee: fee('8000unym'),
			transfers: [
				{ sender: w, recipient: NYX.friend, amount: '1000000unym' },
				{ sender: w, recipient: NYX.exchange, amount: '2000000unym' }
			]
		}),
		// A fee-only transaction (a vote, say): nothing moves but the fee.
		cosmosTx({ seed: 'fee-only', height: 2500, fee: fee('1500unym') }),
		// The old format: base64 attributes, triples in one event, no fee event.
		cosmosTx({
			seed: 'legacy',
			height: 2600,
			fee: fee('2500unym'),
			legacyEvents: true,
			transfers: [{ sender: NYX.friend, recipient: w, amount: '3000000unym' }]
		}),
		// To itself: nothing but the fee.
		cosmosTx({
			seed: 'self',
			height: 2700,
			fee: fee('1000unym'),
			transfers: [{ sender: w, recipient: w, amount: '5000000unym' }]
		})
	];
	for (let i = 0; i < filler; i++) {
		txs.push(
			cosmosTx({
				seed: `filler-${i}`,
				height: 3000 + i,
				fee: { payer: NYX.friend, amount: '1000unym' },
				transfers: [{ sender: NYX.friend, recipient: w, amount: '1000unym' }]
			})
		);
	}
	return txs;
}

/**
 * @param {object} [options]
 * @param {string} [options.network] the chain id `status` names
 * @param {any[]} [options.txs]
 * @param {Record<string, { denom: string, amount: string }[]>} [options.balances]
 * @param {number} [options.earliestHeight]
 * @param {number} [options.failFirst] this many requests answer 503 first
 * @param {(height: number) => string} [options.time]
 */
export async function startFakeCosmos({
	network = 'nyx',
	txs = sampleNyxHistory(),
	balances = {
		[NYX.wallet]: [
			{ denom: 'unym', amount: '137000000' },
			{ denom: 'unyx', amount: '2000000' },
			{ denom: 'ibc/ABCDEF0123456789', amount: '7000000' }
		]
	},
	earliestHeight = 1,
	failFirst = 0,
	time = blockTime
} = {}) {
	/** @type {{ method: string, params: any }[]} */
	const calls = [];
	let failing = failFirst;
	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const reply = (/** @type {number} */ status, /** @type {unknown} */ body) => {
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(body));
			};
			if (failing > 0) {
				failing--;
				res.writeHead(503, { 'Content-Type': 'text/html' });
				return res.end('<html>busy</html>');
			}
			const url = new URL(req.url ?? '/', 'http://127.0.0.1');
			const bank = /^\/cosmos\/bank\/v1beta1\/balances\/([^/]+)$/.exec(url.pathname);
			if (req.method === 'GET' && bank) {
				calls.push({ method: 'balances', params: {} });
				return reply(200, {
					balances: balances[decodeURIComponent(bank[1])] ?? [],
					pagination: { next_key: null, total: '0' }
				});
			}
			if (req.method !== 'POST') return reply(404, { code: 5, message: 'not found' });
			/** @type {any} */ let body;
			try {
				body = JSON.parse(raw);
			} catch {
				return reply(200, {
					jsonrpc: '2.0',
					id: -1,
					error: { code: -32700, message: 'Parse error' }
				});
			}
			const { method, params = {} } = body;
			calls.push({ method, params });
			const ok = (/** @type {unknown} */ result) =>
				reply(200, { jsonrpc: '2.0', id: body.id, result });
			if (method === 'status') {
				return ok({
					node_info: { network, version: '0.38.17' },
					sync_info: {
						earliest_block_height: String(earliestHeight),
						earliest_block_time: time(Math.max(earliestHeight, 1000)),
						latest_block_height: '99999'
					}
				});
			}
			if (method === 'header') {
				return ok({ header: { height: String(params.height), time: time(Number(params.height)) } });
			}
			if (method === 'tx_search') {
				const m = /^(transfer\.sender|transfer\.recipient)='([a-z0-9]+)'$/.exec(
					String(params.query)
				);
				if (!m) {
					return reply(200, {
						jsonrpc: '2.0',
						id: body.id,
						error: { code: -32603, message: 'Internal error', data: `bad query ${params.query}` }
					});
				}
				const [, key, who] = m;
				const attr = key === 'transfer.sender' ? 'sender' : 'recipient';
				const b64 = (/** @type {string} */ s) => Buffer.from(s).toString('base64');
				const matching = txs.filter(
					(tx) =>
						Number(tx.height) >= earliestHeight &&
						tx.tx_result.events.some(
							(/** @type {any} */ e) =>
								(e.type === 'transfer' || e.type === b64('transfer')) &&
								e.attributes.some(
									(/** @type {any} */ a) =>
										(a.key === attr && a.value === who) ||
										(a.key === b64(attr) && a.value === b64(who))
								)
						)
				);
				const perPage = Math.min(Number(params.per_page ?? 30), 100);
				const page = Number(params.page ?? 1);
				const sorted = [...matching].sort((a, b) =>
					params.order_by === 'desc' ? b.height - a.height : a.height - b.height
				);
				return ok({
					txs: sorted.slice((page - 1) * perPage, page * perPage),
					total_count: String(matching.length)
				});
			}
			return reply(200, {
				jsonrpc: '2.0',
				id: body.id,
				error: { code: -32601, message: 'Method not found' }
			});
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	const url = `http://127.0.0.1:${port}`;
	return {
		url,
		endpoints: { rpc: url, rest: url },
		calls,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}

/** The addresses and contracts the EVM samples use. */
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
 * @param {ReturnType<typeof sampleEvmHistory>} [options.history]
 * @param {Record<string, string>} [options.balances] `native` and contract → units
 * @param {number} [options.rateLimitedCalls] this many answer Blockscout's "rate limit" first
 * @param {number} [options.maxOffset] page × offset beyond this is refused, as Blockscout does
 * @param {string | null} [options.chainId] what `…/api/eth-rpc` answers to eth_chainId; null: 404
 */
export async function startFakeBlockscout({
	history = sampleEvmHistory(),
	balances = { native: '310000000000000000', [EVM.usdc]: '450000000' },
	rateLimitedCalls = 0,
	maxOffset = 10_000,
	chainId = '0x1'
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
		const p = Object.fromEntries(url.searchParams);
		calls.push(p);
		const reply = (/** @type {unknown} */ body) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
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
