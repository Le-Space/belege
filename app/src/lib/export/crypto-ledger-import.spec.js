// A crypto-ledger file into the books (issue #267): the hand-written check
// agrees with the schema, a file Belege wrote comes back as the same
// movements, a second import adds nothing, and what Belege cannot read yet
// is named, not guessed. Every address, hash, amount and name is made up.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { memoryCollection } from '../bank/test-support.js';
import { cryptoLedger } from './crypto-ledger.js';
import { checkCryptoLedger, importCryptoLedger, toCents } from './crypto-ledger-import.js';
import { EVM, accounts, h, now, transactions } from './crypto-ledger.fixtures.js';

const SCHEMA_DIR = new URL('../../../../schema/', import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(
	JSON.parse(readFileSync(new URL('crypto-ledger.v1.schema.json', SCHEMA_DIR), 'utf8'))
);
const examples = readdirSync(new URL('examples/', SCHEMA_DIR))
	.filter((f) => f.endsWith('.json'))
	.map((f) => ({
		f,
		doc: JSON.parse(readFileSync(new URL(`examples/${f}`, SCHEMA_DIR), 'utf8'))
	}));

const store = () => ({
	accounts: memoryCollection('accounts').collection,
	transactions: memoryCollection('transactions').collection,
	events: memoryCollection('events').collection
});

/** Belege's own books as a file. */
const exported = () => cryptoLedger({ accounts, transactions, now });

describe('checkCryptoLedger', () => {
	it('accepts what the schema accepts: the examples and what Belege writes', () => {
		for (const { f, doc } of examples) expect([f, checkCryptoLedger(doc)]).toEqual([f, []]);
		expect(validate(exported())).toBe(true);
		expect(checkCryptoLedger(exported())).toEqual([]);
	});

	it('refuses what the schema refuses', () => {
		const evm = examples.find((e) => e.f === 'evm.json')?.doc;
		/** @type {((d: any) => void)[]} */
		const changes = [
			(d) => (d.movements[0].amount = 1200),
			(d) => (d.movements[0].amount = '1.2e3'),
			(d) => (d.movements[0].amount = '01'),
			(d) => (d.movements[0].gasPrice = '1'),
			(d) => (d.movements[0].kind = 'deposit'),
			(d) => (d.movements[0].time = '2025-05-02'),
			(d) => (d.movements[0].date = '2025-02-30T00:00:00Z'),
			(d) => (d.movements[0].asset.decimals = 37),
			(d) => (d.movements[0].asset.symbol = 'usdc'),
			(d) => (d.movements[0].value.rate = 0.88),
			(d) => delete d.movements[0].value,
			(d) => (d.movements[0].txHash = ''),
			(d) => (d.movements[0].counterparty = { address: '' }),
			(d) => (d.movements[0].explorerUrl = 'http://example.org'),
			(d) => delete d.accounts[0].chain,
			(d) => (d.accounts[0].chain = 'ethereum'),
			(d) => (d.accounts[0].exchange = 'kraken'),
			(d) => (d.accounts[0].type = 'bank'),
			(d) => (d.currency = 'eur'),
			(d) => (d.version = 2),
			(d) => (d.format = 'other'),
			(d) => (d.extra = true)
		];
		for (const [i, change] of changes.entries()) {
			const d = structuredClone(evm);
			change(d);
			expect([i, validate(d)]).toEqual([i, false]);
			expect([i, checkCryptoLedger(d).length > 0]).toEqual([i, true]);
		}
	});

	it('and what the schema can only describe: an unknown account, too many decimals', () => {
		const d = structuredClone(examples.find((e) => e.f === 'evm.json')?.doc);
		d.movements[0].account = 'eip155:1:0x9999999999999999999999999999999999999999';
		d.movements[1].amount = '-0.0000000000000000001';
		expect(checkCryptoLedger(d)).toEqual([
			'movements[0]: account "eip155:1:0x9999999999999999999999999999999999999999" is not in the file',
			'movements[1]: amount has more decimals than ETH'
		]);
	});

	it('cents: half away from zero', () => {
		expect([
			toCents('105'),
			toCents('-0.03'),
			toCents('-0.005'),
			toCents('1.234'),
			toCents('2.995')
		]).toEqual([10500, -3, -1, 123, 300]);
	});
});

describe('importCryptoLedger', () => {
	it('a file Belege wrote comes back as the same movements, and a second import adds nothing', async () => {
		const file = exported();
		const s = store();
		const first = await importCryptoLedger({ store: s, text: JSON.stringify(file) });
		expect([first.new, first.updated, first.skipped, first.unpriced, first.left]).toEqual([
			file.movements.length,
			0,
			0,
			1,
			[]
		]);
		const again = cryptoLedger({
			accounts: await s.accounts.list(),
			transactions: await s.transactions.list(),
			now
		});
		expect(again.movements).toEqual(file.movements);
		expect(again.accounts.map((a) => a.id)).toEqual(file.accounts.map((a) => a.id));

		const second = await importCryptoLedger({ store: s, text: JSON.stringify(file) });
		expect([second.new, second.updated, second.skipped]).toEqual([0, 0, file.movements.length]);
		const events = (await s.events.list()).filter((e) => e.kind === 'bank-sync');
		expect(events.map((e) => e.source)).toEqual(['crypto-ledger', 'crypto-ledger']);
		expect(events.map((e) => e.new).sort((a, b) => a - b)).toEqual([0, file.movements.length]);
	});

	it('only adds: a booking a sync wrote, or one deleted by hand, stays as it is', async () => {
		const s = store();
		const file = exported();
		await importCryptoLedger({ store: s, text: JSON.stringify(file) });
		const [swap] = await s.transactions.list({
			where: (t) => t.sourceId === `0x${h('c')}:erc20:0`
		});
		// What a sync knows and the file does not, and a booking deleted by hand.
		await s.transactions.put({
			...swap,
			purpose: 'Tausch: 1.200 USDC ← 0,5 ETH',
			swap: { gave: [], got: [] }
		});
		const [gone] = await s.transactions.list({ where: (t) => t.sourceId === `0x${h('b')}:fee` });
		await s.transactions.put({ ...gone, deleted: true });
		const r = await importCryptoLedger({ store: s, text: JSON.stringify(file) });
		expect([r.new, r.updated, r.skipped]).toEqual([0, 0, file.movements.length]);
		const [kept] = await s.transactions.list({
			where: (t) => t.sourceId === `0x${h('c')}:erc20:0`
		});
		expect([kept.purpose, kept.swap]).toEqual([
			'Tausch: 1.200 USDC ← 0,5 ETH',
			{ gave: [], got: [] }
		]);
		const [still] = await s.transactions.list({
			includeDeleted: true,
			where: (t) => t.sourceId === `0x${h('b')}:fee`
		});
		expect(still.deleted).toBe(true);
	});

	it('books into the accounts a sync uses, kept as a sync keeps them', async () => {
		const s = store();
		// Kraken's own account keeps BTC with 10 decimals; the file has 8.
		const kraken = await s.accounts.put({
			source: 'kraken',
			sourceAccountId: 'BTC',
			ibanLast4: '',
			name: 'Kraken BTC',
			currency: 'EUR',
			kind: 'exchange',
			asset: 'BTC',
			decimals: 10
		});
		const doc = structuredClone(examples.find((e) => e.f === 'exchange.json')?.doc);
		for (const m of doc.movements) if (m.asset.symbol === 'BTC') m.asset.decimals = 8;
		await importCryptoLedger({ store: s, text: JSON.stringify(doc) });
		const list = await s.accounts.list();
		expect(
			list
				.filter((a) => a.source === 'kraken')
				.map((a) => a.sourceAccountId)
				.sort()
		).toEqual(['BTC', 'EUR']);
		const booked = await s.transactions.list({ where: (t) => t.accountId === kraken.id });
		const withdrawal = booked.find((t) => t.sourceId === 'LEXAMP-DDDDD-DDDDDD');
		expect(withdrawal).toMatchObject({
			quantity: '-60000000',
			decimals: 10,
			amountCents: -48000,
			movement: 'transfer',
			bookingType: 'Auszahlung',
			txRef: 'FEXAMP-EEEEE-EEEEEE',
			chainTxRef: h('d'),
			chainMethod: 'Bitcoin',
			exchangeType: 'withdrawal'
		});
		const fee = booked.find((t) => t.sourceId === 'LEXAMP-CCCCC-CCCCCC:fee');
		expect([fee?.movement, fee?.bookingType, fee?.amountCents]).toEqual(['fee', 'Gebühr', -80]);

		// A wallet: its address normalised, the account name a sync gives it.
		await importCryptoLedger({
			store: s,
			text: JSON.stringify(examples.find((e) => e.f === 'evm.json')?.doc)
		});
		const eth = (await s.accounts.list()).find((a) => a.source === 'base' && a.asset === 'ETH');
		expect([eth?.sourceAccountId, eth?.name, eth?.kind, eth?.walletAddress]).toEqual([
			`${EVM}:ETH`,
			`Wallet ETH (Base) ···${EVM.slice(-6)}`,
			'wallet',
			EVM
		]);
		const gas = (await s.transactions.list()).find((t) => t.sourceId === `0x${h('b')}:fee`);
		expect([gas?.counterparty, gas?.bookingType, gas?.movement, gas?.quantity]).toEqual([
			'Netzwerkgebühr',
			'Netzwerkgebühr',
			'fee',
			'-21000000000000'
		]);
	});

	it('a movement without a rate is kept, its euro amount open', async () => {
		const s = store();
		const r = await importCryptoLedger({
			store: s,
			text: JSON.stringify(examples.find((e) => e.f === 'monero.json')?.doc)
		});
		expect(r.unpriced).toBe(1);
		const open = (await s.transactions.list()).find((t) => t.amountCents === 0);
		expect([open?.quantity, open?.valuation, open?.rateMissing]).toEqual([
			'-700000000000',
			null,
			{ reason: 'kein Kurs in der Datei' }
		]);
	});

	it('a chain or exchange Belege does not read yet is named and left out', async () => {
		const s = store();
		const doc = structuredClone(examples.find((e) => e.f === 'exchange.json')?.doc);
		doc.accounts.push(
			{ id: 'binance', type: 'exchange', name: 'Binance', exchange: 'binance' },
			{
				id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:ExampleSolanaAddress1111111111111111111',
				type: 'wallet',
				name: 'Solana',
				chain: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
				address: 'ExampleSolanaAddress1111111111111111111'
			}
		);
		doc.movements.push({ ...doc.movements[3], id: 'B-1', account: 'binance' });
		const r = await importCryptoLedger({ store: s, text: JSON.stringify(doc) });
		expect(r.left).toEqual([
			{ account: 'binance', reason: 'exchange binance', movements: 1 },
			{
				account: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:ExampleSolanaAddress1111111111111111111',
				reason: 'chain solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
				movements: 0
			}
		]);
		expect(r.new).toBe(4);
	});

	it('refuses what is no crypto-ledger file, or one in another currency', async () => {
		const s = store();
		await expect(importCryptoLedger({ store: s, text: 'date,amount\n' })).rejects.toThrow(
			'no JSON'
		);
		await expect(
			importCryptoLedger({ store: s, text: JSON.stringify({ format: 'crypto-ledger' }) })
		).rejects.toThrow('Not a valid crypto-ledger file: file: version must be 1');
		const usd = { ...examples[0].doc, currency: 'USD' };
		await expect(importCryptoLedger({ store: s, text: JSON.stringify(usd) })).rejects.toThrow(
			'valued in USD'
		);
		expect(await s.transactions.list()).toEqual([]);
	});
});
