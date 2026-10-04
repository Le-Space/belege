// The crypto bookings in the open crypto-ledger format (issue #267): the
// schema accepts its own examples and what Belege writes, and refuses what a
// reader would misread. Every address, hash, amount and name is made up.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import { CSV_COLUMNS, cryptoLedger, cryptoLedgerCsv } from './crypto-ledger.js';
import {
	EVM,
	OTHER,
	XMR,
	accounts,
	h,
	now,
	transactions,
	wallets
} from './crypto-ledger.fixtures.js';

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
