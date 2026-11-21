// Aleph Cloud (issue #113): the scan of own addresses and the monthly
// statement as an Eigenbeleg. Everything made up.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { extractText, getDocumentProxy } from 'unpdf';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import {
	candidateAddresses,
	correctAlephStatement,
	createAlephStatement,
	addAlephAccount,
	findStatement,
	lastDay,
	learnAlephPurchases,
	loadAleph,
	previousMonth,
	purchasesOf,
	removeAlephAccount,
	rememberPurchases,
	saveAleph,
	scanAleph
} from './aleph.js';
import { monthlyLines } from './statement-pdf.js';

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
		expect(candidateAddresses(wallets, { scan: false, extra: [C] })).toEqual([C]);
		expect(candidateAddresses(wallets, { scan: true, extra: [C] })).toEqual([
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
	it('a statement is corrected by a new one that names it; the old keeps its number and leaves the lists', async () => {
		// First made with a valuation many times too high, then read again with the right one.
		const wrong = statement({
			totals: { topUps: 20_000, transfersOut: 0, usage: 70_000, eurCents: 480 }
		});
		const right = statement();
		let answer = wrong;
		const client = { alephStatement: async () => answer };
		const p = { store, blobs, client, address: A, month: '2026-08', issuer: 'Beispiel GmbH' };
		await expect(correctAlephStatement(p)).rejects.toThrow(/keinen Verbrauchsnachweis/);
		const first = await createAlephStatement({ ...p, now: () => new Date('2026-09-02T08:00:00Z') });
		expect(first.number).toBe('EB-2026-001');
		// The bridge still answers the same: nothing to correct, nothing changed.
		await expect(correctAlephStatement(p)).rejects.toThrow(/dieselben Zahlen wie in EB-2026-001/);
		expect(await store.receipts.list()).toHaveLength(1);

		answer = right;
		const second = await correctAlephStatement({
			...p,
			now: () => new Date('2026-11-21T08:00:00Z')
		});
		expect([second.number, second.replaced]).toEqual(['EB-2026-002', 'EB-2026-001']);
		// Only the new one is the month's statement and in the lists.
		const listed = await store.receipts.list();
		expect(listed.map((/** @type {any} */ r) => r.selfNumber)).toEqual(['EB-2026-002']);
		expect(findStatement(listed, A, '2026-08')?.id).toBe(second.receipt.id);
		expect(listed[0]).toMatchObject({ amountCents: 6, selfReceipt: { replaces: 'EB-2026-001' } });
		// The old one: kept with its number and file, marked.
		const old = await store.receipts.get(first.receipt.id);
		expect(old).toMatchObject({
			deleted: true,
			selfNumber: 'EB-2026-001',
			amountCents: 480,
			fileCid: first.receipt.fileCid,
			selfReceipt: { replacedBy: 'EB-2026-002', replacedAt: '2026-11-21T08:00:00.000Z' }
		});
		// Its number is never given out again.
		answer = statement({ month: '2026-09' });
		const next = await createAlephStatement({ ...p, month: '2026-09' });
		expect(next.number).toBe('EB-2026-003');

		const text = (
			await extractText(await getDocumentProxy(await blobs.get(listed[0].fileCid)), {
				mergePages: true
			})
		).text.replace(/\s+/g, ' ');
		expect(text).toContain('Dieser Beleg ersetzt EB-2026-001 vom');
		expect(text).toContain('4,80 EUR');
		const actions = (await store.events.list()).map((/** @type {any} */ e) => e.action);
		expect(actions).toContain('aleph-statement-corrected');
	});

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
			'Aleph Cloud stellt keine Rechnung aus',
			// The month in sums, in the words of @le-space/eigenbeleg's `monthly`.
			'Monatsübersicht',
			'Verbrauch test-relay (ababababab…) 1 60.000 0,05',
			'Verbrauch Speicher (storage) 1 10.000 0,01',
			'Verbrauch gesamt (Aufwand) 2 70.000 0,06',
			'Käufe von Guthaben (Vorauszahlung; Eigenbeleg je Kauf) 1 20.000 —'
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

	it('the month in sums: per resource over the days, transfers apart, no euro where a day has no rate', () => {
		const day = statement().usage;
		const s = statement({
			usage: [
				...day,
				{ ...day[0], date: '2026-08-02', credits: 40_000, eurCents: 4 },
				{ ...day[1], date: '2026-08-02', eurCents: null }
			],
			topUps: [
				...statement().topUps,
				{
					...statement().topUps[0],
					how: 'transfer',
					credits: 5_000,
					bonus: 0,
					price: null,
					from: B
				}
			],
			transfersOut: [{ time: '2026-08-20T12:00:00.000Z', credits: 3_000, to: C }]
		});
		expect(monthlyLines(s).lines.map((l) => [l.label, l.rows, l.amount, l.eur])).toEqual([
			['Verbrauch test-relay (ababababab…)', 2, '100000', '0.09'],
			['Verbrauch Speicher (storage)', 2, '20000', ''],
			['Verbrauch gesamt (Aufwand)', 4, '120000', ''],
			['Käufe von Guthaben (Vorauszahlung; Eigenbeleg je Kauf)', 1, '20000', ''],
			['Eingänge von anderen Konten', 1, '5000', ''],
			['Ausgänge an andere Konten', 1, '3000', '']
		]);
		expect(monthlyLines(statement({ usage: [], topUps: [] })).lines).toEqual([]);
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

	it('keeps the purchases a statement names, each once, by the paying transaction', async () => {
		const H1 = '0x' + 'a1'.repeat(32);
		const H2 = '0x' + 'b2'.repeat(32);
		const listed = /** @type {any} */ ({
			...statement(),
			purchases: [
				{
					time: '2026-05-02T10:00:00.000Z',
					credits: 500_000,
					price: '0.000001',
					token: 'ALEPH',
					chain: 'ETH',
					txHash: H1
				},
				{
					time: '2026-08-10T09:00:00.000Z',
					credits: 100_000,
					price: '0.000001',
					token: 'USDC',
					chain: 'BASE',
					txHash: H2
				},
				{
					time: '2026-08-11T09:00:00.000Z',
					credits: 1,
					price: '1',
					token: null,
					chain: null,
					txHash: 'not a hash!'
				}
			]
		});
		expect(purchasesOf(listed).map((p) => p.txHash)).toEqual([H1, H2]);
		expect(await rememberPurchases(store.settings, listed)).toBe(2);
		expect(await rememberPurchases(store.settings, listed)).toBe(0);
		expect((await loadAleph(store.settings)).purchases).toEqual([
			{
				address: A,
				txHash: H1,
				time: '2026-05-02T10:00:00.000Z',
				credits: 500_000,
				chain: 'ETH',
				token: 'ALEPH'
			},
			{
				address: A,
				txHash: H2,
				time: '2026-08-10T09:00:00.000Z',
				credits: 100_000,
				chain: 'BASE',
				token: 'USDC'
			}
		]);
		// An older bridge lists none: the month's own purchases are taken.
		const old = statement();
		expect(purchasesOf(old).length).toBe(
			old.topUps.filter((t) => t.how === 'purchase' && t.txHash).length
		);
	});

	it('reads the purchases at the scan, from the running month’s statement', async () => {
		const H = '0x' + 'c3'.repeat(32);
		/** @type {string[]} */
		const asked = [];
		const client = {
			alephAccounts: async (/** @type {string[]} */ addresses) =>
				addresses.map((address) => ({ address, credits: 10, entries: 1 })),
			alephStatement: async (/** @type {string} */ address, /** @type {string} */ month) => {
				asked.push(`${address} ${month}`);
				return /** @type {any} */ ({
					...statement({ address, month }),
					purchases: [
						{
							time: '2026-09-03T08:00:00.000Z',
							credits: 7,
							price: '0.000001',
							token: 'ALEPH',
							chain: 'ETH',
							txHash: H
						}
					]
				});
			}
		};
		await saveAleph(store.settings, { extra: [A] });
		const out = await scanAleph({
			client,
			settings: store.settings,
			wallets: [],
			now: () => new Date('2026-09-15T12:00:00Z')
		});
		expect(asked).toEqual([`${A} 2026-09`]);
		expect(out.purchases).toBe(1);
		expect((await loadAleph(store.settings)).purchases.map((p) => p.txHash)).toEqual([H]);
	});

	it('after a wallet sync: asks only when Aleph is in use, and never fails the sync', async () => {
		let asked = 0;
		const client = {
			alephAccounts: async () => {
				asked++;
				throw new Error('Aleph does not answer');
			}
		};
		// Nothing of Aleph in these books: not asked.
		expect(await learnAlephPurchases({ client, settings: store.settings, wallets: [] })).toBe(0);
		expect(asked).toBe(0);
		// In use: asked, and an error is no error of the sync.
		await saveAleph(store.settings, { extra: [A] });
		expect(await learnAlephPurchases({ client, settings: store.settings, wallets: [] })).toBe(0);
		expect(asked).toBe(1);
	});

	it('keeps a typed-in account with its name, and takes it off again', async () => {
		await addAlephAccount(store.settings, A, '  Projekt Nord ');
		await addAlephAccount(store.settings, B);
		let aleph = await loadAleph(store.settings);
		expect(aleph.extra).toEqual([A, B]);
		expect(aleph.names).toEqual({ [A.toLowerCase()]: 'Projekt Nord' });
		// Entered again: once in the list, its name changed.
		await addAlephAccount(store.settings, A, 'Projekt Süd');
		aleph = await loadAleph(store.settings);
		expect(aleph.extra).toEqual([A, B]);
		expect(aleph.names[A.toLowerCase()]).toBe('Projekt Süd');

		// Found at Aleph, then taken off: the account goes with it …
		await saveAleph(store.settings, {
			accounts: [
				{ address: A, credits: 5, entries: 1, checkedAt: '2026-09-01T10:00:00.000Z' },
				{ address: B, credits: 1, entries: 1, checkedAt: '2026-09-01T10:00:00.000Z' }
			]
		});
		aleph = await removeAlephAccount(store.settings, A);
		expect(aleph.extra).toEqual([B]);
		expect(aleph.names).toEqual({});
		expect(aleph.accounts.map((a) => a.address)).toEqual([B]);
		// … unless it is asked anyway (an own wallet, the scan on).
		aleph = await removeAlephAccount(store.settings, B, { keep: true });
		expect(aleph.extra).toEqual([]);
		expect(aleph.accounts.map((a) => a.address)).toEqual([B]);
	});
});
