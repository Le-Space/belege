import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { buildMatchingContext } from '../matching/context.js';
import { classifyTransaction } from '../matching/classify.js';
import { describeEntry, krakenTransactions, syncKraken } from './kraken-sync.js';

/** @typedef {import('../bridge/client.js').KrakenLedgerEntry} Entry */

/** @param {Partial<Entry> & { id: string, refid: string, asset: string, amount: string }} e @returns {Entry} */
const entry = (e) => ({
	time: `${e.date ?? '2026-09-02'}T10:00:00.000Z`,
	date: '2026-09-02',
	type: 'trade',
	subtype: '',
	wallet: 'spot',
	fee: '0',
	decimals: e.asset === 'EUR' ? 4 : 10,
	...e
});

/** Made-up ledger: a deposit, a buy, a crypto swap, spot → earn, a reward, a withdrawal. */
const LEDGER = [
	entry({
		id: 'L-DEP',
		refid: 'R-DEP',
		type: 'deposit',
		date: '2026-09-01',
		asset: 'EUR',
		amount: '1000.0000'
	}),
	entry({ id: 'L-B-EUR', refid: 'R-BUY', asset: 'EUR', amount: '-600.0000', fee: '1.5600' }),
	entry({ id: 'L-B-BTC', refid: 'R-BUY', asset: 'BTC', amount: '0.0100000000' }),
	entry({
		id: 'L-S-BTC',
		refid: 'R-SWAP',
		date: '2026-09-03',
		asset: 'BTC',
		amount: '-0.0020000000'
	}),
	entry({
		id: 'L-S-ETH',
		refid: 'R-SWAP',
		date: '2026-09-03',
		asset: 'ETH',
		amount: '0.0500000000',
		fee: '0.0001000000'
	}),
	entry({
		id: 'L-E-OUT',
		refid: 'R-EARN',
		type: 'transfer',
		subtype: 'spottostaking',
		date: '2026-09-05',
		asset: 'BTC',
		amount: '-0.0010000000'
	}),
	entry({
		id: 'L-E-IN',
		refid: 'R-EARN',
		type: 'transfer',
		subtype: 'stakingfromspot',
		date: '2026-09-05',
		asset: 'BTC',
		wallet: 'earn',
		amount: '0.0010000000'
	}),
	entry({
		id: 'L-RW',
		refid: 'R-RW',
		type: 'staking',
		date: '2026-09-06',
		asset: 'AKT',
		wallet: 'earn',
		decimals: 8,
		amount: '0.12345678'
	}),
	entry({
		id: 'L-WD',
		refid: 'R-WD',
		type: 'withdrawal',
		date: '2026-09-12',
		asset: 'EUR',
		amount: '-300.0000',
		fee: '0.0900'
	})
];

/** Kraken's EUR prices of the made-up month. */
const PRICES = /** @type {Record<string, string>} */ ({ BTC: '60000', ETH: '2400', AKT: '2.5' });

/** @type {(asset: string, date: string) => Promise<import('../assets/valuation.js').Rate>} */
const rate = async (asset, date) => {
	if (!PRICES[asset]) throw new Error(`no rate found for ${asset} on ${date}`);
	return {
		asset,
		date,
		currency: 'EUR',
		rate: PRICES[asset],
		usdRate: null,
		source: 'kraken',
		at: `${date}T00:00:00Z`
	};
};

describe('krakenTransactions', () => {
	it('books every entry on its asset’s account, fees as bookings of their own', async () => {
		const { byAccount, unpriced } = await krakenTransactions(LEDGER, rate);
		expect(unpriced).toEqual([]);
		expect([...byAccount.keys()].sort()).toEqual(['AKT.earn', 'BTC', 'BTC.earn', 'ETH', 'EUR']);
		expect(byAccount.get('EUR')?.map((t) => [t.sourceId, t.amountCents, t.movement])).toEqual([
			['L-DEP', 100000, 'transfer'],
			['L-B-EUR', -60000, 'trade'],
			['L-B-EUR:fee', -156, 'fee'],
			['L-WD', -30000, 'transfer'],
			['L-WD:fee', -9, 'fee']
		]);
	});

	it('values a buy against euros at what was paid, not at the day’s rate', async () => {
		const { byAccount } = await krakenTransactions(LEDGER, rate);
		const buy = byAccount.get('BTC')?.find((t) => t.sourceId === 'L-B-BTC');
		expect(buy?.amountCents).toBe(60000);
		expect(buy?.crypto).toEqual({
			asset: 'BTC',
			quantity: '100000000',
			decimals: 10,
			valuation: { rate: '60000', currency: 'EUR', source: 'trade', at: '2026-09-02T10:00:00.000Z' }
		});
		expect(buy?.txRef).toBe('R-BUY');
	});

	it('values a swap by the leg that goes out; the leg that comes in mirrors it', async () => {
		const { byAccount } = await krakenTransactions(LEDGER, rate);
		const out = byAccount.get('BTC')?.find((t) => t.sourceId === 'L-S-BTC');
		const into = byAccount.get('ETH')?.find((t) => t.sourceId === 'L-S-ETH');
		expect(out?.amountCents).toBe(-12000); // 0.002 BTC × 60 000
		expect(out?.crypto?.valuation.source).toBe('kraken');
		expect(into?.amountCents).toBe(12000);
		expect(into?.crypto?.valuation).toMatchObject({ source: 'trade', rate: '2400' });
		// The ETH fee at the rate its entry was valued with: 0.0001 × 2 400 = 0,24
		const fee = byAccount.get('ETH')?.find((t) => t.sourceId === 'L-S-ETH:fee');
		expect(fee).toMatchObject({ amountCents: -24, movement: 'fee' });
		expect(fee?.crypto?.quantity).toBe('-1000000');
	});

	it('values transfers and rewards at the day’s rate, and names the reward', async () => {
		const { byAccount } = await krakenTransactions(LEDGER, rate);
		expect(byAccount.get('BTC.earn')?.[0]).toMatchObject({
			amountCents: 6000,
			movement: 'transfer'
		});
		expect(byAccount.get('AKT.earn')?.[0]).toMatchObject({
			amountCents: 31, // 0.12345678 × 2,5
			movement: 'reward',
			bookingType: 'Staking-Ertrag'
		});
		expect(
			describeEntry(
				entry({ id: 'x', refid: 'x', asset: 'DOT', amount: '1', type: 'earn', subtype: 'reward' })
			)
		).toEqual({
			label: 'Earn-Ertrag',
			movement: 'reward'
		});
	});

	it('leaves out a whole group without a rate, and says so', async () => {
		const unknown = [
			entry({ id: 'L-X-EUR', refid: 'R-X', asset: 'EUR', amount: '-10.0000' }),
			entry({ id: 'L-X-DOT', refid: 'R-X', asset: 'DOT', amount: '1.0000000000' }),
			entry({ id: 'L-X-RW', refid: 'R-XRW', type: 'staking', asset: 'DOT', amount: '1.0000000000' })
		];
		const { byAccount, unpriced } = await krakenTransactions(unknown, rate);
		// the buy needs no rate: it carries its own price
		expect(byAccount.get('DOT')?.[0]).toMatchObject({ amountCents: 1000 });
		expect(unpriced).toEqual([
			{
				refid: 'R-XRW',
				date: '2026-09-02',
				asset: 'DOT',
				reason: 'no rate found for DOT on 2026-09-02'
			}
		]);
	});
});

describe('Kraken transfers (#52)', () => {
	it('labels a transfer by its subtype, and shows an unknown one as Kraken writes it', () => {
		const e = (/** @type {string} */ type, /** @type {string} */ subtype) =>
			describeEntry(entry({ id: 'x', refid: 'x', asset: 'NYM', amount: '-1', type, subtype }));
		expect(e('transfer', 'spottostaking').label).toBe('Umbuchung Spot/Earn');
		expect(e('transfer', 'spotfromfutures').label).toBe('Umbuchung Spot/Futures');
		expect(e('transfer', '')).toEqual({ label: 'Kraken: transfer', movement: 'transfer' });
		expect(e('transfer', 'airdrop').label).toBe('Kraken: transfer/airdrop');
		expect(e('earn', 'allocation').label).toBe('Umbuchung Spot/Earn');
		expect(e('adjustment', '').label).toBe('Kraken: adjustment');
		expect(e('withdrawal', '').label).toBe('Auszahlung');
	});

	it('keeps Kraken’s type and a crypto withdrawal’s on-chain hash', async () => {
		const hash = 'AB'.repeat(32);
		const { byAccount } = await krakenTransactions(
			[
				entry({
					id: 'L-NYM-OUT',
					refid: 'R-NYM-OUT',
					type: 'withdrawal',
					asset: 'NYM',
					decimals: 8,
					amount: '-10.00000000',
					transferRef: hash
				}),
				entry({
					id: 'L-EUR-OUT',
					refid: 'R-EUR-OUT',
					type: 'withdrawal',
					asset: 'EUR',
					amount: '-5.0000',
					transferRef: 'BANKREF-1'
				})
			],
			async (asset, date) => ({
				asset,
				date,
				currency: 'EUR',
				rate: '0.05',
				usdRate: null,
				source: 'kraken',
				at: `${date}T00:00:00Z`
			})
		);
		expect(byAccount.get('NYM')?.[0]).toMatchObject({
			exchangeType: 'withdrawal',
			chainTxRef: hash,
			amountCents: -50
		});
		// a euro withdrawal's reference is the bank's, no chain hash
		expect(byAccount.get('EUR')?.[0]).not.toHaveProperty('chainTxRef');
	});

	it('pairs a withdrawal with the wallet that received it by hash, whatever the euro amounts', async () => {
		const hash = 'ab'.repeat(32);
		const transactions = [
			{
				id: 'K',
				accountId: 'A-KRAKEN-NYM',
				source: 'kraken',
				bookedOn: '2026-09-10',
				amountCents: -50,
				movement: 'transfer',
				txRef: 'R-NYM-OUT',
				chainTxRef: hash.toUpperCase()
			},
			{
				id: 'KF',
				accountId: 'A-KRAKEN-NYM',
				source: 'kraken',
				bookedOn: '2026-09-10',
				amountCents: -1,
				movement: 'fee',
				txRef: 'R-NYM-OUT'
			},
			{
				id: 'W',
				accountId: 'A-WALLET-NYM',
				source: 'nym',
				bookedOn: '2026-09-10',
				amountCents: 52,
				movement: 'transfer',
				txRef: `0x${hash}`
			},
			{
				id: 'X',
				accountId: 'A-OTHER',
				source: 'nym',
				bookedOn: '2026-09-10',
				amountCents: 52,
				movement: 'transfer',
				txRef: 'cd'.repeat(32)
			}
		];
		const ctx = await buildMatchingContext({ accounts: [], transactions, settings: null });
		expect(classifyTransaction(transactions[0], ctx)).toMatchObject({
			kind: 'own-transfer',
			via: 'reference',
			counterBookingId: 'W',
			sign: 'gleicher Transaktions-Hash'
		});
		expect(classifyTransaction(transactions[2], ctx)).toMatchObject({
			via: 'reference',
			counterBookingId: 'K'
		});
		// the fee is a fee, not a side of the transfer
		expect(classifyTransaction(transactions[1], ctx)).toMatchObject({ kind: 'bank-fee' });
		// a person who said "no transfer" is heard
		const refused = await buildMatchingContext({
			accounts: [],
			transactions,
			settings: { notTransfers: ['K|W'] }
		});
		expect(classifyTransaction(transactions[0], refused)?.via).not.toBe('reference');
	});
});

describe('syncKraken', () => {
	function store() {
		return {
			accounts: memoryCollection('accounts').collection,
			transactions: memoryCollection('transactions').collection,
			events: memoryCollection('events').collection
		};
	}
	/** @param {Entry[]} entries */
	function fakeClient(entries) {
		/** @type {string[]} */ const asked = [];
		const client = /** @type {any} */ ({
			krakenBalances: async () => ({
				balances: [
					{ asset: 'EUR', wallet: 'spot', amount: '98.3500', decimals: 4 },
					{ asset: 'BTC', wallet: 'spot', amount: '0.0070000000', decimals: 10 }
				]
			}),
			krakenLedgers: async (/** @type {string} */ since) => {
				asked.push(`ledgers ${since}`);
				return { since, entries };
			},
			rate: async (
				/** @type {string} */ asset,
				/** @type {string} */ date,
				/** @type {any} */ options
			) => {
				asked.push(`rate ${asset} ${date} ${options?.prefer}`);
				return rate(asset, date);
			}
		});
		return { client, asked };
	}

	it('creates one account per asset and wallet, imports, and asks Kraken’s prices first', async () => {
		const s = store();
		const { client, asked } = fakeClient(LEDGER);
		const now = new Date('2026-09-26T08:00:00Z');
		const result = await syncKraken({ client, store: s, now });

		expect(result.since).toBe('2026-01-01');
		expect(result.transferRefs).toBe('ok');
		expect(result.totals.new).toBe(LEDGER.length + 3);
		// Every booking keeps Kraken's time.
		const booked = await s.transactions.list();
		expect(
			booked.every((b) => typeof b.bookedAt === 'string' && b.bookedAt.startsWith(b.bookedOn))
		).toBe(true);
		expect(asked.filter((a) => a.startsWith('rate')).every((a) => a.endsWith('kraken'))).toBe(true);

		const accounts = await s.accounts.list();
		expect(accounts.map((a) => a.name).sort()).toEqual([
			'Kraken AKT (Earn)',
			'Kraken BTC',
			'Kraken BTC (Earn)',
			'Kraken ETH',
			'Kraken EUR'
		]);
		const eur = accounts.find((a) => a.name === 'Kraken EUR');
		expect(eur).toMatchObject({
			source: 'kraken',
			kind: 'exchange',
			asset: 'EUR',
			balance: '98.3500',
			lastSyncedOn: '2026-09-26',
			ibanLast4: ''
		});

		// Again: nothing new, and it starts a week before the last sync.
		const again = await syncKraken({ client, store: s, now });
		expect(again.since).toBe('2026-09-19');
		expect(again.totals.new).toBe(0);
	});

	it('the legs of a trade and of a spot/earn transfer are own transfers; fees and rewards need no receipt', async () => {
		const s = store();
		await syncKraken({
			client: fakeClient(LEDGER).client,
			store: s,
			now: new Date('2026-09-26T08:00:00Z')
		});
		const accounts = await s.accounts.list();
		const transactions = await s.transactions.list();
		const ctx = await buildMatchingContext({ accounts, transactions, settings: null });
		const kind = (/** @type {string} */ sourceId) => {
			const tx = transactions.find((t) => t.sourceId === sourceId);
			return classifyTransaction(/** @type {any} */ (tx), ctx);
		};
		expect(kind('L-B-EUR')).toMatchObject({ kind: 'own-transfer', via: 'reference' });
		expect(kind('L-B-BTC')).toMatchObject({ kind: 'own-transfer', via: 'reference' });
		expect(kind('L-S-ETH')).toMatchObject({ kind: 'own-transfer', via: 'reference' });
		expect(kind('L-E-IN')).toMatchObject({ kind: 'own-transfer', via: 'reference' });
		expect(kind('L-B-EUR:fee')).toMatchObject({ kind: 'bank-fee', via: 'exchange-fee' });
		expect(kind('L-RW')).toMatchObject({ kind: 'crypto-reward' });
	});

	it('a euro withdrawal and the bank’s credit are one own transfer', async () => {
		const s = store();
		await syncKraken({
			client: fakeClient(LEDGER).client,
			store: s,
			now: new Date('2026-09-26T08:00:00Z')
		});
		const bank = await s.accounts.put({
			source: 'camt',
			sourceAccountId: 'k',
			ibanLast4: '0000',
			name: 'Konto A',
			currency: 'EUR'
		});
		await s.transactions.put({
			accountId: bank.id,
			source: 'camt',
			bookedOn: '2026-09-13',
			amountCents: 30000,
			currency: 'EUR',
			counterparty: 'Börsenbetreiber Beispiel Ltd',
			purpose: 'Auszahlung'
		});
		const transactions = await s.transactions.list();
		const ctx = await buildMatchingContext({
			accounts: await s.accounts.list(),
			transactions,
			settings: null
		});
		const credit = transactions.find((t) => t.accountId === bank.id);
		expect(classifyTransaction(/** @type {any} */ (credit), ctx)).toMatchObject({
			kind: 'own-transfer',
			via: 'counter-booking',
			sign: 'Kraken'
		});
	});

	it('a group without a rate is fetched again next time', async () => {
		const s = store();
		const ledger = [
			...LEDGER,
			entry({
				id: 'L-DOT',
				refid: 'R-DOT',
				type: 'staking',
				date: '2026-09-20',
				asset: 'DOT',
				amount: '1.0000000000'
			})
		];
		const result = await syncKraken({
			client: fakeClient(ledger).client,
			store: s,
			now: new Date('2026-09-26T08:00:00Z')
		});
		expect(result.unpriced).toHaveLength(1);
		const accounts = await s.accounts.list();
		expect(accounts.every((a) => a.lastSyncedOn === '2026-09-20')).toBe(true);
	});
});
