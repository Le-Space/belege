// The monthly Akash usage statement (#305, step 2): each deployment's usage
// spread over its time and counted for the month, the wallet's fees and
// top-ups, the statement as an Eigenbeleg that covers the month's fees, and
// those fees as one collective booking in the export. Every address, hash,
// dseq and amount is made up.
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBlockstore } from 'blockstore-core/memory';
import { extractText, getDocumentProxy } from 'unpdf';

import { memoryCollection } from '../bank/test-support.js';
import { createBlobStore } from '../receipts/blob-store.js';
import { collectNetworkFees } from '../export/plan.js';
import { akashMonth, usageInMonth } from './usage.js';
import { createAkashStatement, findAkashStatement } from './statement.js';
import { actAccount } from './act-account.js';

const ADDRESS = `akash1${'q'.repeat(38)}`;
const h = (/** @type {string} */ c) => c.repeat(64);

/** @param {Partial<import('../bridge/client.js').AkashDeployment>} d */
const deployment = (d) => ({
	dseq: '1000',
	state: 'closed',
	createdHeight: 1,
	createdAt: '2026-07-10T00:00:00.000Z',
	settledHeight: 2,
	settledAt: '2026-07-20T00:00:00.000Z',
	transferred: '1',
	funds: '0',
	...d
});

describe('usageInMonth', () => {
	it('a deployment within the month counts whole; one across two months is split by time', () => {
		const within = deployment({ dseq: '1' });
		// 10 days in June, 20 in July.
		const across = deployment({
			dseq: '2',
			createdAt: '2026-06-21T00:00:00.000Z',
			settledAt: '2026-07-21T00:00:00.000Z',
			transferred: '3'
		});
		const july = usageInMonth([within, across], '2026-07');
		expect(july.map((u) => [u.dseq, u.inMonth])).toEqual([
			['1', '1'],
			['2', '2']
		]);
		expect(usageInMonth([within, across], '2026-06').map((u) => [u.dseq, u.inMonth])).toEqual([
			['2', '1']
		]);
		expect(usageInMonth([within], '2026-08')).toEqual([]);
	});

	it('one that lived no time counts where it was created; one without times is left out', () => {
		const instant = deployment({ settledAt: '2026-07-10T00:00:00.000Z', transferred: '0.5' });
		expect(usageInMonth([instant], '2026-07')[0].inMonth).toBe('0.5');
		expect(usageInMonth([deployment({ createdAt: null })], '2026-07')).toEqual([]);
	});
});

describe('akashMonth', () => {
	const accounts = [
		{ id: 'acc-akt', source: 'akash', walletAddress: ADDRESS, asset: 'AKT' },
		{ id: 'acc-other', source: 'akash', walletAddress: `akash1${'p'.repeat(38)}`, asset: 'AKT' }
	];
	/** @param {Record<string, any>} t */
	const tx = (t) => ({
		accountId: 'acc-akt',
		source: 'akash',
		currency: 'EUR',
		asset: 'AKT',
		decimals: 6,
		...t
	});
	const transactions = [
		tx({
			id: 'f1',
			movement: 'fee',
			bookedOn: '2026-07-12',
			amountCents: -1,
			quantity: '-5000',
			txRef: h('A'),
			purpose: 'Netzwerkgebühr · Memo: akash: CreateLease · Tx …'
		}),
		tx({
			id: 'f2',
			movement: 'fee',
			bookedOn: '2026-07-13',
			amountCents: -2,
			quantity: '-7000',
			txRef: h('B')
		}),
		tx({
			id: 'm1',
			movement: 'trade',
			bookedOn: '2026-07-11',
			amountCents: -2500,
			quantity: '-27500000',
			txRef: h('C'),
			swap: { via: 'Akash BME (AKT ↔ ACT)', got: [{ asset: 'ACT', amount: '', listed: false }] }
		}),
		// another month, another wallet, deleted
		tx({ id: 'f3', movement: 'fee', bookedOn: '2026-06-30', amountCents: -1, quantity: '-5000' }),
		tx({
			id: 'f4',
			movement: 'fee',
			bookedOn: '2026-07-12',
			amountCents: -1,
			quantity: '-5000',
			accountId: 'acc-other'
		}),
		tx({
			id: 'f5',
			movement: 'fee',
			bookedOn: '2026-07-12',
			amountCents: -1,
			quantity: '-5000',
			deleted: true
		})
	];

	it('the month’s fees, top-ups and usage, in euros at the dollar rate for ACT', () => {
		const m = akashMonth({
			month: '2026-07',
			address: ADDRESS,
			accounts,
			transactions,
			deployments: [deployment({ transferred: '2.5' })],
			eurPerUsd: { rate: '0.9', date: '2026-07-31' }
		});
		expect(m.fees.map((f) => [f.id, f.akt, f.eurCents, f.memo])).toEqual([
			['f1', '0.005', 1, 'akash: CreateLease'],
			['f2', '0.007', 2, '']
		]);
		expect(m.topUps).toMatchObject([{ id: 'm1', akt: '27.5', act: null, eurCents: 2500 }]);
		expect(m.totals).toEqual({
			feesAkt: '0.012',
			feesEurCents: 3,
			topUpsAkt: '27.5',
			usageAct: '2.5',
			usageEurCents: 225
		});
		const noRate = akashMonth({
			month: '2026-07',
			address: ADDRESS,
			accounts,
			transactions,
			deployments: [],
			eurPerUsd: null
		});
		expect(noRate.totals.usageEurCents).toBeNull();
	});
});

describe('createAkashStatement', () => {
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

	const client = {
		akashDeployments: async () => ({
			deployments: [deployment({ dseq: '4242', transferred: '1.2' })]
		}),
		rate: async () => ({ rate: '0.9', at: '2026-07-31T00:00:00Z' })
	};

	it('an Eigenbeleg that covers the month’s fees; the PDF says what it holds; once per month', async () => {
		const account = await store.accounts.put({
			source: 'akash',
			walletAddress: ADDRESS,
			asset: 'AKT'
		});
		const fees = [];
		for (const [day, n] of [
			['2026-07-12', 'A'],
			['2026-07-13', 'B']
		]) {
			fees.push(
				await store.transactions.put({
					accountId: account.id,
					source: 'akash',
					movement: 'fee',
					bookedOn: day,
					amountCents: -1,
					currency: 'EUR',
					asset: 'AKT',
					decimals: 6,
					quantity: '-5000',
					txRef: h(n)
				})
			);
		}
		const made = await createAkashStatement({
			store,
			blobs,
			client,
			wallet: { address: ADDRESS, name: 'Akash · AKT' },
			month: '2026-07',
			issuer: 'Beispiel UG',
			now: () => new Date('2026-08-02T10:00:00Z')
		});
		expect(made.number).toBe('EB-2026-001');
		expect(made.linked).toBe(2);
		expect(made.receipt).toMatchObject({
			source: 'eigenbeleg',
			amountCents: 2,
			documentDate: '2026-07-31',
			selfReceipt: {
				kind: 'akash-statement',
				akash: { fees: 2, usageAct: '1.2', usageEurCents: 108 }
			}
		});
		const matches = await store.matches.list();
		expect(
			matches.map((/** @type {any} */ m) => [m.receiptId, m.transactionId, m.state]).sort()
		).toEqual(fees.map((f) => [made.receipt.id, f.id, 'confirmed']).sort());
		const bytes = await blobs.get(String(made.receipt.fileCid));
		const text = (
			await extractText(await getDocumentProxy(bytes), { mergePages: true })
		).text.replace(/\s+/g, ' ');
		for (const expected of [
			'EB-2026-001',
			'Beispiel UG',
			'Akash Network',
			'2 Transaktionen',
			'4242',
			'1,2 ACT'
		]) {
			expect(text).toContain(expected);
		}
		// The hash, wrapped in its column.
		expect(text.replace(/\s/g, '')).toContain(h('A'));
		expect(findAkashStatement(await store.receipts.list(), ADDRESS, '2026-07')?.id).toBe(
			made.receipt.id
		);
		await expect(
			createAkashStatement({ store, blobs, client, wallet: { address: ADDRESS }, month: '2026-07' })
		).rejects.toThrow('EB-2026-001');
	});

	it('nothing in the month: no statement', async () => {
		await expect(
			createAkashStatement({
				store,
				blobs,
				client: { ...client, akashDeployments: async () => ({ deployments: [] }) },
				wallet: { address: ADDRESS },
				month: '2026-07'
			})
		).rejects.toThrow(/kein Nachweis|no statement/);
	});
});

describe('collectNetworkFees', () => {
	const statement = { id: 'R-ST', selfReceipt: { kind: 'akash-statement' } };
	/** @param {string} id @param {string} date @param {number} cents @param {Record<string, any>} [more] */
	const line = (id, date, cents, more = {}) => ({
		tx: { id, movement: 'fee', bookedOn: date },
		bank: null,
		receipts: [statement],
		match: null,
		transferWith: null,
		line: {
			amountCents: cents,
			currency: 'EUR',
			account: '1370',
			contra: '4970',
			taxKey: '',
			date,
			receiptNumber: 'B-7',
			text: 'Netzwerkgebühr',
			costCentre: ''
		},
		...more
	});

	it('the fees one statement covers become one line; others stay as they are', () => {
		const other = {
			...line('pay', '2026-07-15', -5000),
			tx: { id: 'pay', movement: 'transfer', bookedOn: '2026-07-15' },
			receipts: []
		};
		const out = collectNetworkFees(
			[
				line('f1', '2026-07-12', -1),
				line('f2', '2026-07-20', -2),
				other,
				line('f3', '2026-07-13', -1)
			],
			'2026-07'
		);
		expect(out.map((l) => [l.tx.id, l.line.amountCents, l.line.date, l.line.text])).toEqual([
			['pay', -5000, '2026-07-15', 'Netzwerkgebühr'],
			['f2', -4, '2026-07-20', 'Netzwerkgebühren Akash 07/2026 (3 Tx)']
		]);
		expect(out[1].collected?.map((t) => t.id)).toEqual(['f1', 'f2', 'f3']);
		expect(out[1].line.receiptNumber).toBe('B-7');
	});

	it('another contra account, or one fee alone, is not collected', () => {
		const out = collectNetworkFees(
			[
				line('f1', '2026-07-12', -1),
				line('f2', '2026-07-13', -1, {}),
				{
					...line('f3', '2026-07-14', -1),
					line: { ...line('f3', '2026-07-14', -1).line, contra: '4900' }
				}
			],
			'2026-07'
		);
		expect(out.map((l) => l.collected?.length ?? 1)).toEqual([2, 1]);
	});
});

describe('actAccount', () => {
	const accounts = [{ id: 'acc', source: 'akash', walletAddress: ADDRESS, asset: 'AKT' }];
	/** @param {string} id @param {string} day @param {string} uakt @param {number} cents @param {string} [act] */
	const mint = (id, day, uakt, cents, act = '') => ({
		id,
		accountId: 'acc',
		source: 'akash',
		movement: 'trade',
		bookedOn: day,
		amountCents: -cents,
		quantity: `-${uakt}`,
		decimals: 6,
		swap: { via: 'Akash BME (AKT ↔ ACT)', got: [{ asset: 'ACT', amount: act, listed: false }] }
	});

	it('minted = held + escrow + used; older mints share what is left by AKT burnt; usage at cost', () => {
		const a = actAccount({
			address: ADDRESS,
			accounts,
			transactions: [
				// 30 AKT for 6 ACT (from the node), and two older ones without an amount.
				mint('m1', '2026-04-11', '30000000', 600, '6'),
				mint('m2', '2026-04-11', '10000000', 200),
				mint('m3', '2026-04-12', '30000000', 600)
			],
			deployments: [
				deployment({
					createdAt: '2026-04-20T00:00:00.000Z',
					settledAt: '2026-04-30T00:00:00.000Z',
					transferred: '4'
				}),
				deployment({
					dseq: '2',
					state: 'active',
					createdAt: '2026-07-10T00:00:00.000Z',
					settledAt: '2026-07-20T00:00:00.000Z',
					transferred: '2',
					funds: '1'
				})
			],
			actBalance: '7',
			untilMonth: '2026-07'
		});
		// 7 held + 1 in escrow + 6 used = 14 minted: 6 known, 8 shared 1:3.
		expect([a.minted, a.used, a.held, a.escrow, a.derived]).toEqual(['14', '6', '7', '1', true]);
		expect(a.topUps.map((t) => [t.id, t.act])).toEqual([
			['m1', '6'],
			['m2', '2'],
			['m3', '6']
		]);
		// 14 € for 14 ACT: 1 € each, at cost.
		expect([a.costCents, a.perActCents, a.usedCents, a.leftCents]).toEqual([1400, 100, 600, 800]);
		expect(a.months.map((m) => [m.month, m.minted, m.used, m.balance])).toEqual([
			['2026-04', '14', '4', '10'],
			['2026-05', '0', '0', '10'],
			['2026-06', '0', '0', '10'],
			['2026-07', '0', '2', '8']
		]);
	});

	it('every mint known: nothing derived', () => {
		const a = actAccount({
			address: ADDRESS,
			accounts,
			transactions: [mint('m1', '2026-07-01', '5000000', 100, '1')],
			deployments: [],
			actBalance: '1',
			untilMonth: '2026-07'
		});
		expect(a.derived).toBe(false);
		expect(a.months).toEqual([
			{ month: '2026-07', minted: '1', used: '0', balance: '1', costCents: 100, usedCents: 0 }
		]);
	});
});
