// Aleph Cloud (issue #113): the scan of own addresses and the monthly
// statement as an Eigenbeleg. Everything made up.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { extractText, getDocumentProxy } from 'unpdf';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import {
	candidateAddresses,
	createAlephStatement,
	findStatement,
	lastDay,
	loadAleph,
	previousMonth,
	saveAleph,
	scanAleph
} from './aleph.js';

const A = '0x' + '1a'.repeat(20);
const B = '0x' + '2b'.repeat(20);
const C = '0x' + '3c'.repeat(20);
const VM = 'ab'.repeat(32);

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

/** @returns {import('../bridge/client.js').AlephStatement} */
function statement(overrides = {}) {
	return {
		address: A,
		month: '2026-08',
		from: '2026-08-01T00:00:00.000Z',
		until: '2026-08-31T23:59:59.000Z',
		opening: 1_000_000,
		closing: 950_000,
		topUps: [
			{
				time: '2026-08-10T09:00:00.000Z',
				credits: 20_000,
				bonus: 0,
				how: 'purchase',
				price: '0.000001',
				token: 'USDC',
				chain: 'ETH',
				txHash: '0x' + 'cd'.repeat(32),
				from: ''
			}
		],
		transfersOut: [],
		usage: [
			{
				date: '2026-08-01',
				kind: 'execution',
				resource: VM,
				credits: 60_000,
				entries: 24,
				resources: 0,
				sizeMib: null,
				usdPerCredit: '0.000001',
				priceSource: 'purchase',
				eurPerUsd: '0.9',
				eurCents: 5
			},
			{
				date: '2026-08-01',
				kind: 'storage',
				resource: null,
				credits: 10_000,
				entries: 24,
				resources: 12,
				sizeMib: 1500.25,
				usdPerCredit: '0.000001',
				priceSource: 'purchase',
				eurPerUsd: '0.9',
				eurCents: 1
			}
		],
		resources: { [VM]: { type: 'INSTANCE', name: 'test-relay' } },
		totals: { topUps: 20_000, transfersOut: 0, usage: 70_000, eurCents: 6 },
		difference: 0,
		rateSource: 'ecb',
		entries: 49,
		...overrides
	};
}

describe('which addresses are asked', () => {
	it('own EVM wallets only with the scan on, typed-in accounts always, each once', () => {
		const wallets = [
			{ chain: 'ethereum', address: A },
			{ chain: 'base', address: A.toUpperCase().replace('0X', '0x') },
			{ chain: 'nyx', address: 'n1notanethereumaddress' },
			{ chain: 'polygon', address: B }
		];
		expect(candidateAddresses(wallets, { scan: false, extra: [C], accounts: [] })).toEqual([C]);
		expect(candidateAddresses(wallets, { scan: true, extra: [C], accounts: [] })).toEqual([
			A.toUpperCase().replace('0X', '0x'),
			B,
			C
		]);
	});

	it('keeps the accounts Aleph knows, with when they were checked', async () => {
		await saveAleph(store.settings, { scan: true });
		const asked = /** @type {string[][]} */ ([]);
		const client = {
			alephAccounts: async (/** @type {string[]} */ addresses) => {
				asked.push(addresses);
				return [
					{ address: A, credits: 5, entries: 3 },
					{ address: B, credits: 0, entries: 0 }
				];
			}
		};
		const out = await scanAleph({
			client,
			settings: store.settings,
			wallets: [
				{ chain: 'ethereum', address: A },
				{ chain: 'ethereum', address: B }
			],
			now: () => new Date('2026-09-01T10:00:00Z')
		});
		expect(asked).toEqual([[A, B]]);
		expect(out.accounts.map((a) => a.address)).toEqual([A]);
		expect((await loadAleph(store.settings)).accounts).toEqual([
			{ address: A, credits: 5, entries: 3, checkedAt: '2026-09-01T10:00:00.000Z' }
		]);
	});
});

describe('the months', () => {
	it('last day and previous month', () => {
		expect(lastDay('2026-02')).toBe('2026-02-28');
		expect(lastDay('2028-02')).toBe('2028-02-29');
		expect(previousMonth(new Date('2026-01-15T00:00:00Z'))).toBe('2025-12');
	});
});

describe('the statement as an Eigenbeleg', () => {
	it('is a receipt in the EB range, with every line on the PDF, and only once per month', async () => {
		const client = { alephStatement: async () => statement() };
		const { receipt, number } = await createAlephStatement({
			store,
			blobs,
			client,
			address: A,
			month: '2026-08',
			accountName: 'Hosting',
			issuer: 'Beispiel GmbH',
			createdBy: 'did:key:test',
			now: () => new Date('2026-09-02T08:00:00Z')
		});
		expect(number).toBe('EB-2026-001');
		const stored = await store.receipts.get(receipt.id);
		expect(stored).toMatchObject({
			source: 'eigenbeleg',
			vendor: 'Aleph Cloud (Eigenbeleg)',
			documentDate: '2026-08-31',
			amountCents: 6,
			selfNumber: 'EB-2026-001',
			selfReceipt: {
				kind: 'aleph-statement',
				aleph: { address: A, month: '2026-08', usage: 70_000, difference: 0 }
			}
		});
		expect(findStatement(await store.receipts.list(), A, '2026-08')?.id).toBe(receipt.id);

		const bytes = await blobs.get(stored.fileCid);
		const text = (
			await extractText(await getDocumentProxy(bytes), { mergePages: true })
		).text.replace(/\s+/g, ' ');
		for (const expected of [
			'EB-2026-001',
			'Beispiel GmbH',
			'Hosting',
			'1.000.000 Credits',
			'950.000 Credits',
			'Geht auf',
			'test-relay',
			VM,
			'Speicher (alle Stores): 12 Stores, 1500,3 MiB',
			'0,06 EUR',
			'Aleph Cloud stellt keine Rechnung aus'
		])
			expect(text).toContain(expected);

		await expect(
			createAlephStatement({ store, blobs, client, address: A, month: '2026-08' })
		).rejects.toThrow(/schon den Verbrauchsnachweis EB-2026-001/);
		const events = await store.events.list();
		expect(events.map((/** @type {any} */ e) => [e.kind, e.action, e.number])).toContainEqual([
			'decision',
			'aleph-statement',
			'EB-2026-001'
		]);
	});

	it('a month in which nothing moved makes none', async () => {
		const client = {
			alephStatement: async () =>
				statement({
					topUps: [],
					usage: [],
					totals: { topUps: 0, transfersOut: 0, usage: 0, eurCents: 0 }
				})
		};
		await expect(
			createAlephStatement({ store, blobs, client, address: A, month: '2026-06' })
		).rejects.toThrow(/keine Credits bewegt/);
		expect(await store.receipts.list()).toEqual([]);
	});

	it('many days and instances run onto further pages', async () => {
		const usage = Array.from({ length: 31 * 4 }, (_, i) => ({
			...statement().usage[0],
			date: `2026-08-${String((i % 31) + 1).padStart(2, '0')}`,
			resource: String(i % 4).repeat(64)
		}));
		const client = { alephStatement: async () => statement({ usage }) };
		const { receipt } = await createAlephStatement({
			store,
			blobs,
			client,
			address: A,
			month: '2026-08'
		});
		const bytes = await blobs.get((await store.receipts.get(receipt.id)).fileCid);
		expect((await getDocumentProxy(bytes)).numPages).toBeGreaterThan(1);
	});
});
