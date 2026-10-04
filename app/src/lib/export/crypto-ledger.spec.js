// The crypto bookings in the open crypto-ledger format (issue #267): the
// schema accepts its own examples and what Belege writes, and refuses what a
// reader would misread. Every address, hash, amount and name is made up.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { CSV_COLUMNS, cryptoLedger, cryptoLedgerCsv } from './crypto-ledger.js';

const SCHEMA_DIR = new URL('../../../../schema/', import.meta.url);
const schema = JSON.parse(
	readFileSync(new URL('crypto-ledger.v1.schema.json', SCHEMA_DIR), 'utf8')
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/** @param {unknown} doc */
function errors(doc) {
	return validate(doc) ? [] : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

const h = (/** @type {string} */ c) => c.repeat(64);
const EVM = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const XMR = `4${'A'.repeat(94)}`;
const at = (/** @type {string} */ d) => ({
	rate: '1600',
	currency: 'EUR',
	source: 'coingecko',
	at: `${d}T00:00:00Z`
});

const accounts = [
	{
		id: 'a-eth',
		source: 'base',
		sourceAccountId: `${EVM}:ETH`,
		kind: 'wallet',
		asset: 'ETH',
		decimals: 18,
		walletAddress: EVM
	},
	{
		id: 'a-usdc',
		source: 'base',
		sourceAccountId: `${EVM}:USDC`,
		kind: 'wallet',
		asset: 'USDC',
		decimals: 6,
		walletAddress: EVM
	},
	{
		id: 'a-tok',
		source: 'base',
		sourceAccountId: `${EVM}:XYZ`,
		kind: 'wallet',
		asset: 'XYZ',
		decimals: 18,
		walletAddress: EVM,
		tokenContract: '0x4444444444444444444444444444444444444444'
	},
	{
		id: 'a-xmr',
		source: 'monero',
		sourceAccountId: `${XMR}:XMR`,
		kind: 'wallet',
		asset: 'XMR',
		decimals: 12,
		walletAddress: XMR
	},
	{
		id: 'k-btc',
		source: 'kraken',
		sourceAccountId: 'BTC',
		kind: 'exchange',
		asset: 'BTC',
		decimals: 10
	},
	{
		id: 'k-eur',
		source: 'kraken',
		sourceAccountId: 'EUR',
		kind: 'exchange',
		asset: 'EUR',
		decimals: 4
	},
	{
		id: 'k-earn',
		source: 'kraken',
		sourceAccountId: 'BTC.earn',
		kind: 'exchange',
		asset: 'BTC',
		decimals: 10
	},
	{ id: 'bank', source: 'hibiscus', sourceAccountId: '0042', ibanLast4: '0042', currency: 'EUR' }
];

const transactions = [
	{
		id: 't1',
		accountId: 'a-eth',
		sourceId: `0x${h('b')}:value`,
		bookedOn: '2025-05-03',
		bookedAt: '2025-05-03T09:30:00Z',
		amountCents: -8000,
		currency: 'EUR',
		counterparty: OTHER,
		counterpartyAddress: OTHER,
		purpose: `Überweisung · Memo: rent, May · Tx 0xbbbb…bbbb`,
		movement: 'transfer',
		txRef: `0x${h('b')}`,
		explorerUrl: `https://base.blockscout.com/tx/0x${h('b')}`,
		asset: 'ETH',
		quantity: '-50000000000000000',
		decimals: 18,
		valuation: at('2025-05-03'),
		rateMissing: null
	},
	{
		id: 't2',
		accountId: 'a-eth',
		sourceId: `0x${h('b')}:fee`,
		bookedOn: '2025-05-03',
		bookedAt: '2025-05-03T09:30:00Z',
		amountCents: -3,
		currency: 'EUR',
		counterparty: 'Netzwerkgebühr',
		purpose: 'Netzwerkgebühr · Tx 0xbbbb…bbbb',
		movement: 'fee',
		txRef: `0x${h('b')}`,
		asset: 'ETH',
		quantity: '-21000000000000',
		decimals: 18,
		valuation: at('2025-05-03'),
		rateMissing: null
	},
	{
		id: 't3',
		accountId: 'a-usdc',
		sourceId: `0x${h('c')}:erc20:0`,
		bookedOn: '2025-05-04',
		bookedAt: '2025-05-04T10:00:00Z',
		amountCents: 105600,
		counterparty: 'MetaMask Swap (Router)',
		counterpartyAddress: '0x881d40237659c251811cec9c364ef91dc08d300c',
		purpose: 'Tausch',
		movement: 'trade',
		swap: { gave: [], got: [] },
		txRef: `0x${h('c')}`,
		asset: 'USDC',
		quantity: '1200000000',
		decimals: 6,
		valuation: at('2025-05-04'),
		rateMissing: null
	},
	{
		id: 't4',
		accountId: 'a-tok',
		sourceId: `0x${h('d')}:erc20:1`,
		bookedOn: '2025-05-05',
		amountCents: 0,
		movement: 'transfer',
		txRef: `0x${h('d')}`,
		asset: 'XYZ',
		quantity: '5000000000000000000',
		decimals: 18,
		valuation: null,
		rateMissing: { reason: 'no rate' }
	},
	{
		id: 't5',
		accountId: 'a-xmr',
		sourceId: `${h('e')}:received:0`,
		bookedOn: '2024-12-30',
		bookedAt: '2024-12-30T08:00:00Z',
		amountCents: 15000,
		bookingType: 'Mining-Ertrag',
		purpose: `Mining-Ertrag · Tx ${h('e').slice(0, 6)}…`,
		movement: 'reward',
		txRef: h('e'),
		asset: 'XMR',
		quantity: '1000000000000',
		decimals: 12,
		valuation: { ...at('2024-12-30'), rate: '150' },
		rateMissing: null
	},
	{
		id: 't6',
		accountId: 'k-eur',
		sourceId: 'LEXAMP-AAAAA-AAAAAA',
		bookedOn: '2025-01-05',
		bookedAt: '2025-01-05T10:00:00Z',
		amountCents: -50000,
		currency: 'EUR',
		counterparty: 'Kraken',
		movement: 'trade',
		txRef: 'TEXAMP-BBBBB-BBBBBB',
		exchangeType: 'trade'
	},
	{
		id: 't7',
		accountId: 'k-btc',
		sourceId: 'LEXAMP-CCCCC-CCCCCC',
		bookedOn: '2025-01-05',
		bookedAt: '2025-01-05T10:00:00Z',
		amountCents: 50000,
		counterparty: 'Kraken',
		movement: 'trade',
		txRef: 'TEXAMP-BBBBB-BBBBBB',
		exchangeType: 'trade',
		asset: 'BTC',
		quantity: '62500000',
		decimals: 10,
		valuation: { rate: '80000', currency: 'EUR', source: 'trade', at: '2025-01-05T10:00:00Z' },
		rateMissing: null
	},
	{
		id: 't8',
		accountId: 'k-btc',
		sourceId: 'LEXAMP-DDDDD-DDDDDD',
		bookedOn: '2025-01-20',
		bookedAt: '2025-01-20T09:00:00Z',
		amountCents: -48000,
		counterparty: 'Kraken',
		movement: 'transfer',
		txRef: 'FEXAMP-EEEEE-EEEEEE',
		exchangeType: 'withdrawal',
		chainTxRef: h('f'),
		chainMethod: 'Bitcoin',
		asset: 'BTC',
		quantity: '-60000000',
		decimals: 10,
		valuation: { ...at('2025-01-20'), rate: '80000' },
		rateMissing: null
	},
	{
		id: 't9',
		accountId: 'k-earn',
		sourceId: 'LEXAMP-GGGGG-GGGGGG',
		bookedOn: '2025-02-01',
		amountCents: 80,
		movement: 'reward',
		txRef: 'STEXAMP',
		exchangeType: 'earn/reward',
		asset: 'BTC',
		quantity: '100000',
		decimals: 10,
		valuation: { ...at('2025-02-01'), rate: '80000' },
		rateMissing: null
	},
	{
		id: 't10',
		accountId: 'a-eth',
		sourceId: 'gone',
		bookedOn: '2025-05-06',
		amountCents: 1,
		deleted: true,
		asset: 'ETH',
		quantity: '1',
		decimals: 18,
		valuation: at('2025-05-06')
	},
	{
		id: 't11',
		accountId: 'bank',
		sourceId: 'b1',
		bookedOn: '2025-05-06',
		amountCents: -1999,
		counterparty: 'Muster GmbH',
		purpose: 'Rechnung'
	}
];

const wallets = [{ id: `base:${EVM}`, chain: 'base', address: EVM, name: 'Project wallet' }];
const now = new Date('2025-06-30T12:00:00Z');

describe('the crypto-ledger schema', () => {
	it('accepts every example', () => {
		const dir = new URL('examples/', SCHEMA_DIR);
		const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
		expect(files.length).toBeGreaterThanOrEqual(6);
		for (const f of files) {
			expect([f, errors(JSON.parse(readFileSync(new URL(f, dir), 'utf8')))]).toEqual([f, []]);
		}
	});

	it('refuses what a reader would misread', () => {
		const doc = JSON.parse(readFileSync(new URL('examples/evm.json', SCHEMA_DIR), 'utf8'));
		const broken = (/** @type {(d: any) => void} */ change) => {
			const d = structuredClone(doc);
			change(d);
			return errors(d).length > 0;
		};
		expect(broken((d) => (d.movements[0].amount = 1200))).toBe(true);
		expect(broken((d) => (d.movements[0].amount = '1.2e3'))).toBe(true);
		expect(broken((d) => (d.movements[0].gasPrice = '1'))).toBe(true);
		expect(broken((d) => (d.movements[0].kind = 'deposit'))).toBe(true);
		expect(broken((d) => delete d.accounts[0].chain)).toBe(true);
		expect(broken((d) => (d.accounts[0].exchange = 'kraken'))).toBe(true);
		expect(broken((d) => (d.movements[0].explorerUrl = 'javascript:alert(1)'))).toBe(true);
		expect(broken((d) => (d.version = 2))).toBe(true);
	});
});

describe('cryptoLedger', () => {
	const ledger = cryptoLedger({ accounts, transactions, wallets, generator: 'Belege test', now });

	it('writes a file the schema accepts', () => {
		expect(errors(ledger)).toEqual([]);
		expect(ledger.createdAt).toBe('2025-06-30T12:00:00.000Z');
	});

	it('one account per wallet and exchange account, none for a bank account', () => {
		expect(ledger.accounts).toEqual([
			{
				id: `eip155:8453:${EVM}`,
				type: 'wallet',
				name: 'Project wallet',
				chain: 'eip155:8453',
				address: EVM
			},
			{ id: 'kraken', type: 'exchange', name: 'Kraken', exchange: 'kraken' },
			{ id: 'kraken/earn', type: 'exchange', name: 'Kraken (Earn)', exchange: 'kraken' },
			{
				id: `monero:418015bb9ae982a1975da7d79277c270:${XMR}`,
				type: 'wallet',
				name: `Monero ···${XMR.slice(-6)}`,
				chain: 'monero:418015bb9ae982a1975da7d79277c270',
				address: XMR
			}
		]);
		const ids = ledger.movements.map((m) => `${m.account} ${m.id}`);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ledger.movements.map((m) => m.id)).not.toContain('gone');
		expect(ledger.movements.map((m) => m.id)).not.toContain('b1');
	});

	it('a wallet movement: amount, value, hash, party, memo; the fee apart', () => {
		const byId = new Map(ledger.movements.map((m) => [m.id, m]));
		expect(byId.get(`0x${h('b')}:value`)).toEqual({
			id: `0x${h('b')}:value`,
			account: `eip155:8453:${EVM}`,
			time: '2025-05-03T09:30:00Z',
			date: '2025-05-03',
			kind: 'transfer',
			asset: { symbol: 'ETH', decimals: 18, caip19: 'eip155:8453/slip44:60' },
			amount: '-0.05',
			value: { amount: '-80.00', rate: '1600', source: 'coingecko', at: '2025-05-03T00:00:00Z' },
			txHash: `0x${h('b')}`,
			counterparty: { address: OTHER },
			memo: 'rent, May',
			explorerUrl: `https://base.blockscout.com/tx/0x${h('b')}`
		});
		const fee = byId.get(`0x${h('b')}:fee`);
		expect([fee?.kind, fee?.amount, fee?.value?.amount, fee?.counterparty]).toEqual([
			'fee',
			'-0.000021',
			'-0.03',
			undefined
		]);
		const swap = byId.get(`0x${h('c')}:erc20:0`);
		expect([swap?.kind, swap?.asset.caip19, swap?.counterparty?.name]).toEqual([
			'swap',
			'eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
			'MetaMask Swap (Router)'
		]);
		const token = byId.get(`0x${h('d')}:erc20:1`);
		expect([token?.asset.caip19, token?.value, token?.time]).toEqual([
			'eip155:8453/erc20:0x4444444444444444444444444444444444444444',
			null,
			'2025-05-05T00:00:00Z'
		]);
		const mined = byId.get(`${h('e')}:received:0`);
		expect([mined?.kind, mined?.asset, mined?.amount]).toEqual([
			'mining',
			{ symbol: 'XMR', decimals: 12 },
			'1'
		]);
	});

	it('an exchange movement: its reference, the on-chain hash of a withdrawal, the euro leg worth itself', () => {
		const byId = new Map(ledger.movements.map((m) => [m.id, m]));
		expect(byId.get('LEXAMP-AAAAA-AAAAAA')).toMatchObject({
			account: 'kraken',
			kind: 'trade',
			asset: { symbol: 'EUR', decimals: 2 },
			amount: '-500.00',
			value: { amount: '-500.00', rate: '1', source: 'currency' },
			ref: 'TEXAMP-BBBBB-BBBBBB',
			sourceType: 'trade'
		});
		expect(byId.get('LEXAMP-CCCCC-CCCCCC')?.asset).toEqual({ symbol: 'BTC', decimals: 10 });
		expect(byId.get('LEXAMP-DDDDD-DDDDDD')).toMatchObject({
			amount: '-0.006',
			txHash: h('f'),
			network: 'Bitcoin',
			sourceType: 'withdrawal'
		});
		expect(byId.get('LEXAMP-GGGGG-GGGGGG')).toMatchObject({
			account: 'kraken/earn',
			kind: 'reward'
		});
	});

	it('oldest first, and one year when asked', () => {
		const times = ledger.movements.map((m) => Date.parse(m.time));
		expect(times).toEqual([...times].sort((a, b) => a - b));
		const y2024 = cryptoLedger({ accounts, transactions, year: '2024', now });
		expect(y2024.movements.map((m) => m.id)).toEqual([`${h('e')}:received:0`]);
		expect(y2024.accounts.map((a) => a.type)).toEqual(['wallet']);
		expect(errors(y2024)).toEqual([]);
		expect(errors(cryptoLedger({ accounts: [], transactions: [], now }))).toEqual([]);
	});
});

describe('cryptoLedgerCsv', () => {
	it('one row per movement, quoted where needed, no formulas', () => {
		const ledger = cryptoLedger({
			accounts,
			transactions: transactions.map((tx) =>
				tx.id === 't1' ? { ...tx, purpose: 'Überweisung · Memo: =HYPERLINK("x") · Tx 0xbb' } : tx
			),
			wallets,
			now
		});
		const csv = cryptoLedgerCsv(ledger);
		const lines = csv.split('\r\n');
		expect(lines[0]).toBe(CSV_COLUMNS.join(','));
		expect(lines.at(-1)).toBe('');
		expect(lines.length).toBe(ledger.movements.length + 2);
		const row = lines.find((l) => l.endsWith(`,0x${h('b')}:value`)) ?? '';
		expect(row).toContain(`,-0.05,-80.00,EUR,1600,coingecko,`);
		expect(row).toContain(`,"'=HYPERLINK(""x"")",`);
		expect(row.startsWith('2025-05-03,2025-05-03T09:30:00Z,eip155:8453:')).toBe(true);
	});
});
