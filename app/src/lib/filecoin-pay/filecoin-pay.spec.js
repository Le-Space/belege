// Filecoin Pay: which own Filecoin wallets are payers, and the monthly
// statement as an Eigenbeleg. Everything made up.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { extractText, getDocumentProxy } from 'unpdf';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { toFilecoinAddress } from '../wallets/filecoin-address.js';
import {
	byRail,
	createFilecoinPayStatement,
	filecoinPayRef,
	findFilecoinPayStatement,
	isPayerAddress,
	loadFilecoinPay,
	payerWallets,
	scanFilecoinPay,
	shortAmount
} from './filecoin-pay.js';

const PAYER = '0x' + '1a'.repeat(20);
const WALLET = toFilecoinAddress(PAYER);
const OTHER = toFilecoinAddress('0x' + '2b'.repeat(20));
const PROVIDER_A = '0x' + 'a1'.repeat(20);
const PROVIDER_B = '0x' + 'b2'.repeat(20);
const TX = (/** @type {string} */ c) => '0x' + c.repeat(32);

/** @type {any} */
let store;
/** @type {import('../receipts/blob-store.js').BlobStore} */
let blobs;

beforeEach(async () => {
	store = {};
	for (const name of [
		'transactions',
		'receipts',
		'matches',
		'questions',
		'settings',
		'accounts',
		'events'
	])
		store[name] = memoryCollection(/** @type {any} */ (name)).collection;
	blobs = await createBlobStore({
		blockstore: new MemoryBlockstore(),
		key: crypto.getRandomValues(new Uint8Array(32))
	});
});

/** @returns {import('../bridge/client.js').FilecoinPayStatement} */
function statement(overrides = {}) {
	const line = {
		service: 'Filecoin Warm Storage',
		oneTime: false,
		commission: '0',
		eurPerUnit: '0.9'
	};
	return {
		address: PAYER,
		filecoinAddress: WALLET,
		month: '2026-08',
		from: '2026-08-01T00:00:00.000Z',
		until: '2026-08-31T23:59:59.000Z',
		asset: 'USDFC',
		decimals: 18,
		opening: '10',
		closing: '11',
		deposits: [{ time: '2026-08-25T12:00:00.000Z', amount: '4', other: PAYER, txHash: TX('d1') }],
		withdrawals: [
			{ time: '2026-08-28T12:00:00.000Z', amount: '1', other: PAYER, txHash: TX('d2') }
		],
		usage: [
			{
				...line,
				time: '2026-08-03T09:00:00.000Z',
				date: '2026-08-03',
				railId: '7',
				payee: PROVIDER_A,
				amount: '1.2',
				toPayee: '1.19',
				networkFee: '0.01',
				paidUntil: '2026-08-03T00:00:00.000Z',
				txHash: TX('e1'),
				eurCents: 108
			},
			{
				...line,
				time: '2026-08-20T09:00:00.000Z',
				date: '2026-08-20',
				railId: '8',
				payee: PROVIDER_B,
				amount: '0.500000000000000001',
				toPayee: '0.500000000000000001',
				networkFee: '0',
				paidUntil: '2026-08-19T00:00:00.000Z',
				txHash: TX('e2'),
				eurCents: 45
			},
			{
				...line,
				oneTime: true,
				time: '2026-08-22T12:00:00.000Z',
				date: '2026-08-22',
				railId: '7',
				payee: PROVIDER_A,
				amount: '0.3',
				toPayee: '0.3',
				networkFee: '0',
				paidUntil: null,
				txHash: TX('e3'),
				eurCents: 27
			}
		],
		rails: {
			7: {
				id: '7',
				payee: PROVIDER_A,
				operator: '0x' + 'cc'.repeat(20),
				service: 'Filecoin Warm Storage',
				commissionBps: 50,
				createdAt: '2026-07-01T10:05:00.000Z'
			},
			8: {
				id: '8',
				payee: PROVIDER_B,
				operator: '0x' + 'cc'.repeat(20),
				service: 'Filecoin Warm Storage',
				commissionBps: 0,
				createdAt: '2026-07-01T10:06:00.000Z'
			}
		},
		railCount: 2,
		totals: { deposits: '4', withdrawals: '1', usage: '2.000000000000000001', eurCents: 180 },
		now: { funds: '10.3', lockedUp: '0.25', at: '2026-09-10T00:00:00.000Z' },
		rateSource: 'coingecko',
		source: 'index',
		indexFailed: null,
		movementsFrom: 'events',
		entries: 5,
		blockscoutKey: false,
		...overrides
	};
}

describe('which wallets are asked', () => {
	it('own Filecoin wallets a contract can hold a balance for, each once', () => {
		expect(isPayerAddress(WALLET)).toBe(true);
		expect(isPayerAddress('f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za')).toBe(false);
		expect(isPayerAddress(PAYER)).toBe(false);
		expect(
			payerWallets([
				{ chain: 'filecoin', address: WALLET },
				{ chain: 'filecoin', address: WALLET },
				{ chain: 'filecoin', address: 'f1abjxfbp274xpdqcpuaykwkfb43omjotacm2p3za' },
				{ chain: 'ethereum', address: PAYER }
			]).map((w) => w.address)
		).toEqual([WALLET]);
	});

	it('keeps those with a balance, a rail or a movement; one that cannot be read keeps what was known', async () => {
		const wallets = [
			{ chain: 'filecoin', address: WALLET },
			{ chain: 'filecoin', address: OTHER },
			{ chain: 'ethereum', address: PAYER }
		];
		/** @type {string[][]} */
		const asked = [];
		const client = {
			filecoinPayStatement: async (/** @type {string} */ address, /** @type {string} */ month) => {
				asked.push([address, month]);
				return address === WALLET
					? statement()
					: statement({
							now: { funds: '0', lockedUp: '0', at: '' },
							railCount: 0,
							entries: 0
						});
			}
		};
		const now = () => new Date('2026-09-10T10:00:00Z');
		const first = await scanFilecoinPay({ client, settings: store.settings, wallets, now });
		expect(asked).toEqual([
			[WALLET, '2026-09'],
			[OTHER, '2026-09']
		]);
		expect([first.asked, first.failed, first.keyed]).toEqual([2, [], false]);
		expect((await loadFilecoinPay(store.settings)).accounts).toEqual([
			{
				address: WALLET,
				funds: '10.3',
				lockedUp: '0.25',
				rails: 2,
				checkedAt: '2026-09-10T10:00:00.000Z'
			}
		]);
		const down = {
			filecoinPayStatement: async () => {
				throw new Error('no answer');
			}
		};
		const second = await scanFilecoinPay({ client: down, settings: store.settings, wallets });
		expect(second.failed.map((f) => f.error)).toEqual(['no answer', 'no answer']);
		expect(second.accounts.map((a) => a.address)).toEqual([WALLET]);
	});
});

describe('the numbers', () => {
	it('the month by rail, exact to the last digit; amounts cut for reading', () => {
		expect(byRail(statement())).toEqual([
			{
				railId: '7',
				payee: PROVIDER_A,
				service: 'Filecoin Warm Storage',
				lines: 2,
				amount: '1.5',
				eurCents: 135
			},
			{
				railId: '8',
				payee: PROVIDER_B,
				service: 'Filecoin Warm Storage',
				lines: 1,
				amount: '0.500000000000000001',
				eurCents: 45
			}
		]);
		const noRate = statement();
		noRate.usage[2].eurCents = null;
		expect(byRail(noRate).map((r) => r.eurCents)).toEqual([null, 45]);
		expect(shortAmount('0.500000000000000001')).toBe('0,5');
		expect(shortAmount('1234567.1234567')).toBe('1.234.567,123456');
		expect(shortAmount('10')).toBe('10');
	});
});

describe('the statement as an Eigenbeleg', () => {
	it('is a receipt in the EB range with every line on the PDF, and only once per payer and month', async () => {
		let calls = 0;
		const client = {
			filecoinPayStatement: async () => {
				calls++;
				return statement();
			}
		};
		const { receipt, number } = await createFilecoinPayStatement({
			store,
			blobs,
			client,
			address: WALLET,
			month: '2026-08',
			walletName: 'Speicher-Wallet',
			issuer: 'Beispiel GmbH',
			createdBy: 'did:key:test',
			now: () => new Date('2026-09-02T08:00:00Z')
		});
		expect(number).toBe('EB-2026-001');
		const stored = await store.receipts.get(receipt.id);
		expect(stored).toMatchObject({
			source: 'eigenbeleg',
			sourceRef: filecoinPayRef(PAYER, '2026-08'),
			vendor: 'Filecoin Pay (Eigenbeleg)',
			documentDate: '2026-08-31',
			amountCents: 180,
			currency: 'EUR',
			selfNumber: 'EB-2026-001',
			selfReceipt: {
				kind: 'filecoin-pay-statement',
				filecoinPay: {
					address: PAYER,
					filecoinAddress: WALLET,
					month: '2026-08',
					asset: 'USDFC',
					opening: '10',
					closing: '11',
					deposits: '4',
					withdrawals: '1',
					usage: '2.000000000000000001',
					eurCents: 180,
					settlements: 3,
					source: 'index',
					movementsFrom: 'events'
				}
			}
		});
		expect(stored.selfReceipt.filecoinPay.rails).toHaveLength(2);
		const all = await store.receipts.list();
		// Found by either of the payer's addresses.
		expect(findFilecoinPayStatement(all, WALLET, '2026-08')?.id).toBe(receipt.id);
		expect(findFilecoinPayStatement(all, PAYER, '2026-08')?.id).toBe(receipt.id);
		expect(findFilecoinPayStatement(all, WALLET, '2026-07')).toBeNull();
		expect(findFilecoinPayStatement(all, OTHER, '2026-08')).toBeNull();

		const bytes = await blobs.get(stored.fileCid);
		const text = (
			await extractText(await getDocumentProxy(bytes), { mergePages: true })
		).text.replace(/\s+/g, ' ');
		for (const expected of [
			'EB-2026-001',
			'Beispiel GmbH',
			'Speicher-Wallet',
			WALLET,
			PAYER,
			'Anfangsbestand 10 USDFC',
			'= Endbestand 11 USDFC',
			'10,3 USDFC, davon 0,25 USDFC für laufende Rails gebunden',
			'Monatsübersicht je Rail',
			'Abrechnungen',
			'Filecoin Warm Storage',
			'Einmalzahlung',
			'Aufteilung und Transaktionen',
			// A transaction's hash is longer than its column: it wraps.
			TX('e1').slice(0, 40),
			'1,2 0,9 1,08',
			PROVIDER_B,
			'0,5 %',
			'1,80 EUR',
			'Subgraph bei Goldsky',
			'Gelesen wird nur USDFC',
			'stellt niemand eine Rechnung aus'
		])
			expect(text, expected).toContain(expected);

		await expect(
			createFilecoinPayStatement({ store, blobs, client, address: WALLET, month: '2026-08' })
		).rejects.toThrow(/schon den Filecoin-Pay-Verbrauchsnachweis EB-2026-001/);
		// Asked by the 0x form: the same payer.
		await expect(
			createFilecoinPayStatement({ store, blobs, client, address: PAYER, month: '2026-08' })
		).rejects.toThrow(/EB-2026-001/);
		expect(calls).toBe(1);
		const events = await store.events.list();
		expect(events.map((/** @type {any} */ e) => [e.kind, e.action, e.number])).toContainEqual([
			'decision',
			'filecoin-pay-statement',
			'EB-2026-001'
		]);
	});

	it('takes the month as shown instead of asking again; a month of another is asked', async () => {
		let calls = 0;
		const client = {
			filecoinPayStatement: async (/** @type {string} */ _a, /** @type {string} */ month) => {
				calls++;
				return statement({ month });
			}
		};
		await createFilecoinPayStatement({
			store,
			blobs,
			client,
			address: WALLET,
			month: '2026-08',
			statement: statement()
		});
		expect(calls).toBe(0);
		await createFilecoinPayStatement({
			store,
			blobs,
			client,
			address: WALLET,
			month: '2026-07',
			statement: statement()
		});
		expect(calls).toBe(1);
	});

	it('a month in which nothing moved needs none; without a rate the amount is 0 and the PDF says so', async () => {
		const empty = statement({
			usage: [],
			deposits: [],
			withdrawals: [],
			totals: { deposits: '0', withdrawals: '0', usage: '0', eurCents: 0 }
		});
		await expect(
			createFilecoinPayStatement({
				store,
				blobs,
				client: { filecoinPayStatement: async () => empty },
				address: WALLET,
				month: '2026-08'
			})
		).rejects.toThrow(/nichts abgerechnet/);

		const unrated = statement({
			source: 'logs',
			indexFailed: 'WALLET_HTTP',
			movementsFrom: 'transfers',
			rateSource: null
		});
		unrated.usage = unrated.usage.map((u) => ({ ...u, eurPerUnit: null, eurCents: null }));
		unrated.totals = { ...unrated.totals, eurCents: null };
		const { receipt } = await createFilecoinPayStatement({
			store,
			blobs,
			client: { filecoinPayStatement: async () => unrated },
			address: WALLET,
			month: '2026-08'
		});
		const stored = await store.receipts.get(receipt.id);
		expect(stored.amountCents).toBe(0);
		expect(stored.selfReceipt.filecoinPay).toMatchObject({ eurCents: null, source: 'logs' });
		const text = (
			await extractText(await getDocumentProxy(await blobs.get(stored.fileCid)), {
				mergePages: true
			})
		).text.replace(/\s+/g, ' ');
		expect(text).toContain('der Index hat nicht geantwortet');
		expect(text).toContain('laut Filfox');
	});
});
