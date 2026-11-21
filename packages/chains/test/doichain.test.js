// SPDX-License-Identifier: AGPL-3.0-or-later
// A Doichain address read through ElectrumX (a fake, in memory): addresses
// and their script hashes, the chain check, a payment, a receipt, a reward,
// name operations, a transfer between own addresses, the month's statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
	DOICHAIN,
	blockHash,
	isDoichainAddress,
	probe,
	readDoichain,
	scriptOf,
	scripthashOf,
	statementDoichain,
	verifyChain,
	withServer
} from '../src/doichain.js';
import { connectElectrum } from '../src/electrum.js';
import {
	coinbase,
	fakeDoichain,
	fakeDoichainAddress,
	fakeHeader,
	fakeTxid,
	fakeWebSocket,
	payment
} from './support/fake-electrum.js';

const OURS = fakeDoichainAddress('own address');
const SECOND = fakeDoichainAddress('second own address', 'p2pkh');
const SHOP = fakeDoichainAddress('a shop', 'p2sh');
const FRIEND = fakeDoichainAddress('a customer', 'p2pkh');
const NAME = 'e/wolkenfabrik-example';

// Heights are spaced so that each lands on its own day; 600 s a block.
const day = (/** @type {number} */ height) =>
	new Date((1_780_000_000 + height * 600) * 1000).toISOString().slice(0, 10);

/** One address's life, oldest first. */
const txs = [
	coinbase('friend mines', 90, FRIEND, 50),
	// received 25 from a customer
	payment(
		'customer pays',
		300,
		[['friend mines', 0]],
		[
			{ address: OURS, value: 25 },
			{ address: FRIEND, value: 24.999 }
		]
	),
	// paid a shop 5, change back
	payment(
		'we pay the shop',
		600,
		[['customer pays', 0]],
		[
			{ address: SHOP, value: 5 },
			{ address: OURS, value: 19.999 }
		]
	),
	// registered a name: the name coin and the change come back, only the fee is spent
	payment(
		'we register a name',
		900,
		[['we pay the shop', 1]],
		[
			{ address: OURS, value: 0.01, nameOp: { op: 'name_doi', name: NAME } },
			{ address: OURS, value: 19.988 }
		]
	),
	// moved 2 to our second address
	payment(
		'to our second address',
		1200,
		[['we register a name', 1]],
		[
			{ address: SECOND, value: 2 },
			{ address: OURS, value: 17.987 }
		]
	),
	// mined a block
	coinbase('we mine', 1500, OURS, 12.5),
	// the name goes to the shop, with its coin
	payment(
		'the name moves',
		1800,
		[
			['we register a name', 0],
			['to our second address', 1]
		],
		[
			{ address: SHOP, value: 0.01, nameOp: { op: 'name_update', name: NAME } },
			{ address: OURS, value: 17.986 }
		]
	),
	// not in a block yet
	payment('still in the mempool', 0, [['we mine', 0]], [{ address: SHOP, value: 12.499 }])
];

const net = () => fakeDoichain({ txs });
const read = (/** @type {Partial<Parameters<typeof readDoichain>[0]>} */ more = {}) => {
	const n = net();
	return readDoichain({
		account: OURS,
		from: '2000-01-01',
		to: '2100-01-01',
		connect: n.connect,
		chain: n.chain,
		...more
	});
};

test('an address of each kind has its output script; a typo has none', () => {
	assert.equal(scriptOf(OURS)?.length, 22);
	assert.equal(scriptOf(OURS)?.[0], 0x00);
	assert.equal(scriptOf(SECOND)?.length, 25);
	assert.equal(scriptOf(SHOP)?.length, 23);
	assert.match(OURS, /^dc1q/);
	assert.match(SECOND, /^[MN]/);
	assert.match(SHOP, /^6/);
	for (const a of [OURS, SECOND, SHOP]) assert.ok(isDoichainAddress(a));

	const typo = OURS.slice(0, -1) + (OURS.endsWith('q') ? 'p' : 'q');
	for (const bad of [
		typo,
		SECOND.slice(0, -1) + 'x',
		'',
		'dc1',
		'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
	])
		assert.equal(isDoichainAddress(bad), false, bad);
});

test('the script hash is the SHA-256 of the output script, byte-reversed', () => {
	const script = scriptOf(SECOND);
	assert.ok(script);
	const expected = Buffer.from(createHash('sha256').update(script).digest())
		.reverse()
		.toString('hex');
	assert.equal(scripthashOf(SECOND), expected);
	assert.throws(() => scripthashOf('not an address'), /not a valid Doichain address/);
});

test('a block hash comes from the first 80 bytes of a header, whatever follows', () => {
	const header = fakeHeader('a block');
	assert.equal(blockHash(header), blockHash(header + 'ff'.repeat(300)));
	assert.match(blockHash(header), /^[0-9a-f]{64}$/);
	assert.equal(DOICHAIN.checkpoint.height, 431018);
});

test('a payment is the amount to the other side and the fee to the network', async () => {
	const entries = await read();
	const paid = entries.filter((e) => e.hash === fakeTxid('we pay the shop'));
	assert.deepEqual(
		paid.map((e) => [e.type, e.kind, e.amount, e.counterparty]),
		[
			['sent', 'transfer', '-5', SHOP],
			['fee', 'fee', '-0.001', 'doichain']
		]
	);
	assert.equal(paid[0].chain, 'doichain');
	assert.equal(paid[0].asset, 'DOI');
	assert.equal(paid[0].priceAs, 'DOI');
	assert.equal(paid[0].height, 600);
	assert.equal(paid[0].date, day(600));
	assert.equal(
		paid[0].explorerUrl,
		`https://doi-explorer.le-space.de/tx/${fakeTxid('we pay the shop')}`
	);
	assert.match(paid[1].counterpartyLabel, /Doichain-Netzwerk/);
});

test('a receipt is what came to the address; a mined block is a reward', async () => {
	const entries = await read();
	const received = entries.find((e) => e.hash === fakeTxid('customer pays'));
	assert.deepEqual(
		[received?.type, received?.kind, received?.amount, received?.counterparty],
		['received', 'transfer', '25', FRIEND]
	);
	const mined = entries.find((e) => e.hash === fakeTxid('we mine'));
	assert.deepEqual([mined?.type, mined?.kind, mined?.amount], ['received', 'reward', '12.5']);
});

test('registering a name costs the fee only: the name coin stays with the address', async () => {
	const entries = await read();
	const registered = entries.filter((e) => e.hash === fakeTxid('we register a name'));
	assert.equal(registered.length, 1);
	assert.deepEqual(
		[registered[0].type, registered[0].amount, registered[0].method, registered[0].memo],
		['fee', '-0.001', 'name_doi', `name_doi: ${NAME}`]
	);
});

test('a name that goes to another address takes its coin along', async () => {
	const entries = await read();
	const moved = entries.filter((e) => e.hash === fakeTxid('the name moves'));
	assert.deepEqual(
		moved.map((e) => [e.type, e.amount, e.counterparty, e.method]),
		[
			['sent', '-0.01', SHOP, 'name_update'],
			['fee', '-0.001', 'doichain', 'name_update']
		]
	);
	assert.equal(moved[0].memo, `name_update: ${NAME}`);
});

test('a transfer to another own address of the request is named so', async () => {
	const plain = (await read()).find((e) => e.hash === fakeTxid('to our second address'));
	assert.equal(plain?.counterpartyLabel, '');
	const named = (await read({ own: [OURS, SECOND] })).find(
		(e) => e.hash === fakeTxid('to our second address')
	);
	assert.deepEqual(
		[named?.amount, named?.counterparty, named?.counterpartyLabel],
		['-2', SECOND, 'eigene Adresse']
	);

	// seen from the second address it is a receipt from the first
	const n = net();
	const other = await readDoichain({
		account: SECOND,
		own: [OURS, SECOND],
		from: '2000-01-01',
		to: '2100-01-01',
		connect: n.connect,
		chain: n.chain
	});
	assert.deepEqual(
		other.map((e) => [e.type, e.amount, e.counterparty, e.counterpartyLabel]),
		[['received', '2', OURS, 'eigene Adresse']]
	);
});

test('only confirmed transactions are read, and only the period asked for', async () => {
	const all = await read();
	assert.ok(!all.some((e) => e.hash === fakeTxid('still in the mempool')));
	const some = await read({ from: day(600), to: day(900) });
	assert.deepEqual(
		[...new Set(some.map((e) => e.hash))],
		[fakeTxid('we pay the shop'), fakeTxid('we register a name')]
	);
});

test('a statement reconciles: opening balance plus the period gives the closing balance', async () => {
	const n = net();
	const s = await statementDoichain({
		account: OURS,
		from: day(600),
		to: day(1500),
		connect: n.connect,
		chain: n.chain
	});
	// before: the 25 received; after: less 5, three fees and 2, plus the reward
	assert.equal(s.opening.DOI, '25');
	assert.equal(s.closing.DOI, '30.497');
	const moved = s.entries.reduce((sum, e) => sum + Math.round(Number(e.amount) * 1e8), 0);
	assert.equal(Math.round(25 * 1e8) + moved, Math.round(30.497 * 1e8));
	assert.equal(s.method, 'derived');

	// to the end: the name's coin and one more fee have gone
	const whole = await statementDoichain({
		account: OURS,
		from: '2000-01-01',
		to: '2100-01-01',
		connect: n.connect,
		chain: n.chain
	});
	assert.equal(whole.opening.DOI, '0');
	assert.equal(whole.closing.DOI, '30.486');
});

test('a server on another chain is passed over, and nothing is read from it', async () => {
	const [a, b] = net().chain.endpoints.electrum;
	const n = fakeDoichain({ txs, wrongChain: [a] });
	const entries = await readDoichain({
		account: OURS,
		from: '2000-01-01',
		to: '2100-01-01',
		connect: n.connect,
		chain: n.chain
	});
	assert.ok(entries.length > 0);
	const hostA = new URL(a).host;
	assert.deepEqual(
		n.state.requests.filter(([host]) => host === hostA).map(([, method]) => method),
		['blockchain.block.header']
	);
	assert.equal(n.state.closed, n.state.connections);

	const none = fakeDoichain({ txs, wrongChain: [a, b] });
	await assert.rejects(
		() => probe({ connect: none.connect, chain: none.chain }),
		/no Doichain server on the valid chain answered/
	);
	const dark = fakeDoichain({ txs, down: [a, b] });
	await assert.rejects(
		() => probe({ connect: dark.connect, chain: dark.chain }),
		/no Doichain server answered/
	);
	const up = fakeDoichain({ txs, down: [a] });
	assert.equal((await probe({ connect: up.connect, chain: up.chain })).entries, 1);
});

test('an address that is none is refused before any server is asked', async () => {
	const n = net();
	await assert.rejects(
		() =>
			readDoichain({
				account: 'dc1qnotanaddress',
				from: '2026-10-01',
				to: '2026-10-31',
				connect: n.connect,
				chain: n.chain
			}),
		/not a valid Doichain address/
	);
	assert.equal(n.state.connections, 0);
});

test('ElectrumX over a WebSocket: answers by id, a refusal without the server’s words, a timeout', async () => {
	const header = fakeHeader('the valid chain');
	const Socket = fakeWebSocket(({ method, params }) => {
		if (method === 'server.version') return ['ElectrumX test', '1.4'];
		if (method === 'blockchain.block.header') return header;
		if (method === 'slow') return undefined;
		throw new Error(`bad request for ${JSON.stringify(params)}`);
	});
	const server = await connectElectrum('wss://electrum-a.example:50004', {
		WebSocket: Socket,
		timeoutMs: 50
	});
	assert.equal(server.host, 'electrum-a.example:50004');
	assert.equal(await server.request('blockchain.block.header', [10]), header);
	assert.equal(
		await verifyChain(server, { ...DOICHAIN, checkpoint: { height: 10, hash: blockHash(header) } }),
		true
	);
	assert.equal(await verifyChain(server, DOICHAIN), false);

	const secret = scripthashOf(OURS);
	await assert.rejects(
		() => server.request('blockchain.scripthash.get_history', [secret]),
		(/** @type {any} */ error) =>
			error.code === 'ELECTRUM_REFUSED' &&
			!error.message.includes(secret) &&
			/\(2\)/.test(error.message)
	);
	await assert.rejects(
		() => server.request('slow'),
		(/** @type {any} */ e) => e.code === 'ELECTRUM_TIMEOUT'
	);
	server.close();
	await assert.rejects(
		() => server.request('server.version'),
		(/** @type {any} */ e) => e.code === 'ELECTRUM_CLOSED'
	);

	await assert.rejects(
		() =>
			connectElectrum('wss://electrum-b.example:50004', {
				WebSocket: fakeWebSocket(() => 1, { refuse: true })
			}),
		(/** @type {any} */ e) =>
			e.code === 'ELECTRUM_UNREACHABLE' && /electrum-b\.example/.test(e.message)
	);
	await assert.rejects(
		() => connectElectrum('https://electrum-b.example', { WebSocket: Socket }),
		(/** @type {any} */ e) => e.code === 'ELECTRUM_URL'
	);
});

test('withServer closes the connection also when reading fails', async () => {
	const n = net();
	await assert.rejects(
		() =>
			withServer({ connect: n.connect, chain: n.chain }, async () => {
				throw new Error('reading failed');
			}),
		/reading failed/
	);
	assert.equal(n.state.closed, 1);
});
