// Rewards and Aleph credits get an account of their own (suggest.js 3a), the
// model is never offered the payment's own account or another own one
// (assist-guard.js), and confirming another account moves the rule's account
// (actions.js). Made-up accounts, amounts and names only.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { getSetting, setSetting } from '../store/settings.js';
import { confirmBooking } from './actions.js';
import { allowedPicks, forbiddenAccounts, knownOf } from './assist-guard.js';
import { assistBody } from './assist-request.js';
import { askForList, listAssist, resetListAssist, suggestFor } from './list-assist.svelte.js';
import { cleanDatevSettings, defaultDatevSettings } from './settings.js';
import { CLOUD_CREDITS_ACCOUNT, REWARD_ACCOUNT, searchAccounts } from './skr03.js';
import { accountRuleOf, suggestBooking } from './suggest.js';

/** @param {Record<string, any>} [over] */
const tx = (over = {}) => ({
	id: 't1',
	accountId: 'exchange-eth',
	bookedOn: '2026-10-13',
	counterparty: 'Staking-Ertrag',
	purpose: '',
	amountCents: 12,
	...over
});
const reward = /** @type {const} */ ({ kind: 'crypto-reward' });
const aleph = /** @type {const} */ ({
	kind: 'prepaid-topup',
	vendor: 'Aleph Cloud',
	via: 'aleph-purchase',
	address: '0x0000000000000000000000000000000000000001',
	credits: 1000
});
const ownAccounts = [
	{ id: 'bank', name: 'Konto A', kind: 'bank', ledgerAccount: '1200' },
	{ id: 'exchange-eth', name: 'Börse Konto B – ETH', kind: 'exchange', ledgerAccount: '1510' },
	{ id: 'wallet-eth', name: 'Wallet C – ETH', kind: 'wallet', ledgerAccount: '1520' },
	{ id: 'gone', name: 'Konto D', kind: 'bank', ledgerAccount: '1230', deleted: true }
];

describe('suggestBooking: rewards and Aleph credits', () => {
	it('a staking or earn reward that came in goes on 2700, no key', () => {
		expect(suggestBooking(tx(), { classification: reward })).toMatchObject({
			account: REWARD_ACCOUNT,
			taxKey: '',
			source: 'reward',
			taxVia: 'none'
		});
		expect(REWARD_ACCOUNT).toBe('2700');
	});

	it('a reward on an own wallet (the staking module) too', () => {
		const t = tx({ accountId: 'wallet-eth', source: 'ethereum', movement: 'reward' });
		expect(suggestBooking(t, { classification: reward }).source).toBe('reward');
	});

	it('the settings name another account', () => {
		expect(
			suggestBooking(tx(), { classification: reward, ruleAccounts: { reward: '2750' } }).account
		).toBe('2750');
		// A bad number in the settings: the default.
		expect(
			suggestBooking(tx(), { classification: reward, ruleAccounts: { reward: 'x' } }).account
		).toBe('2700');
	});

	it('a negative "reward" is no income: nothing from this rule', () => {
		expect(accountRuleOf(tx({ amountCents: -5 }), reward)).toBeNull();
		expect(suggestBooking(tx({ amountCents: -5 }), { classification: reward }).source).toBeNull();
	});

	it('a purchase of Aleph credits goes on 4960, or the settings’ account', () => {
		const t = tx({ accountId: 'wallet-eth', amountCents: -1234, counterparty: '0xabc' });
		expect(suggestBooking(t, { classification: aleph })).toMatchObject({
			account: CLOUD_CREDITS_ACCOUNT,
			taxKey: '',
			source: 'cloud-credits'
		});
		expect(CLOUD_CREDITS_ACCOUNT).toBe('4960');
		expect(
			suggestBooking(t, { classification: aleph, ruleAccounts: { cloudCredits: '4806' } }).account
		).toBe('4806');
	});

	it('another prepaid top-up is not an Aleph purchase', () => {
		expect(accountRuleOf(tx({ amountCents: -100 }), { kind: 'prepaid-topup', vendor: 'X' })).toBe(
			null
		);
	});

	it('what the person confirmed wins', () => {
		const t = tx({ booking: { account: '2710', taxKey: '', confirmedAt: '2026-10-14T00:00:00Z' } });
		expect(suggestBooking(t, { classification: reward })).toMatchObject({
			account: '2710',
			source: 'confirmed'
		});
	});

	it('the list takes the settings’ accounts, and does not ask the model about these', () => {
		const app = {
			classifications: { t1: reward },
			matches: [],
			receipts: [],
			partners: [],
			accounts: ownAccounts,
			datevSettings: { rewardAccount: '2750' },
			travel: [],
			chart: null
		};
		expect(suggestFor(tx(), app)).toMatchObject({ account: '2750', source: 'reward' });
	});

	it('settings: defaults, a set number, a bad one', () => {
		expect(defaultDatevSettings()).toMatchObject({
			rewardAccount: '2700',
			cloudCreditsAccount: '4960'
		});
		expect(
			cleanDatevSettings({ rewardAccount: ' 2750 ', cloudCreditsAccount: '12' })
		).toMatchObject({
			rewardAccount: '2750',
			cloudCreditsAccount: '4960'
		});
	});

	it('the catalogue knows both accounts, 2700 among the income', () => {
		const income = searchAccounts('', { income: true });
		expect(income.slice(0, 3).map((a) => a.number)).toContain('2700');
		expect(searchAccounts('4960')[0].number).toBe('4960');
	});
});

describe('assist-guard', () => {
	it('never the payment’s own account, nor another own one', () => {
		const forbidden = forbiddenAccounts({
			tx: tx(),
			accounts: ownAccounts,
			classification: reward
		});
		expect([...forbidden].sort()).toEqual(['1200', '1510', '1520']);
	});

	it('an own transfer may name the other own account, not its own', () => {
		const forbidden = forbiddenAccounts({
			tx: tx({ accountId: 'bank', amountCents: -10000 }),
			accounts: ownAccounts,
			classification: { kind: 'own-transfer', account: '1360' }
		});
		expect([...forbidden]).toEqual(['1200']);
	});

	it('the model answers the own account: dropped, no suggestion', () => {
		const forbidden = forbiddenAccounts({
			tx: tx(),
			accounts: ownAccounts,
			classification: reward
		});
		expect(
			allowedPicks([{ account: '1510', confidence: 'high', reason: 'Gegenstück' }], forbidden)
		).toEqual([]);
		expect(
			allowedPicks(
				[
					{ account: '1520', confidence: 'high', reason: 'Wallet' },
					{ account: '2700', confidence: 'medium', reason: 'Ertrag' }
				],
				forbidden
			).map((p) => p.account)
		).toEqual(['2700']);
	});

	it('what the app knows', () => {
		expect(knownOf(tx(), reward)).toBe('reward');
		expect(knownOf(tx({ amountCents: -1 }), aleph)).toBe('cloud-credits');
		expect(knownOf(tx({ amountCents: -1 }), { kind: 'bank-fee' })).toBe('fee');
		expect(knownOf(tx(), { kind: 'own-transfer' })).toBe('own-transfer');
		expect(knownOf(tx(), null)).toBeNull();
	});
});

describe('assistBody with the guard', () => {
	const chart = {
		format: /** @type {const} */ ('csv'),
		fileName: 'k.csv',
		importedAt: '2026-10-01T00:00:00Z',
		accounts: [
			{ number: '1200', name: 'Bank Konto A' },
			{ number: '1510', name: 'Börse Konto B ETH' },
			{ number: '1520', name: 'Wallet C ETH' },
			{ number: '2700', name: 'Sonstige Erträge' },
			{ number: '4960', name: 'Hosting' }
		]
	};
	const base = {
		tx: tx(),
		receipt: null,
		own: ownAccounts[1],
		partners: [{ id: 'p', name: 'Börse Beispiel', account: '1510' }],
		catalogue: searchAccounts('', { income: true, chart }),
		chart,
		learnedName: (/** @type {string} */ v) => `gebucht für ${v}`
	};

	it('offers no forbidden account, learned or not, and says what it knows', () => {
		const forbidden = forbiddenAccounts({
			tx: tx(),
			accounts: ownAccounts,
			classification: reward
		});
		const body = assistBody({ ...base, forbidden, known: 'reward' });
		const numbers = body.accounts.map((a) => a.number);
		expect(numbers).toContain('2700');
		expect(numbers.filter((n) => forbidden.has(n))).toEqual([]);
		expect(body.learned).toEqual([]);
		expect(body.booking).toMatchObject({ direction: 'in', known: 'reward' });
	});

	it('nothing known: no field (an older bridge refuses unknown ones)', () => {
		expect('known' in assistBody(base).booking).toBe(false);
	});
});

describe('askForList with the guard', () => {
	beforeEach(() => resetListAssist());

	it('a pick of the own account is no pick', async () => {
		const app = {
			classifications: {},
			matches: [],
			receipts: [],
			partners: [],
			accounts: ownAccounts,
			datevSettings: null,
			travel: [],
			chart: null
		};
		/** @type {any[]} */
		const bodies = [];
		const client = {
			bookingAssist: async (/** @type {any} */ body) => {
				bodies.push(body);
				return { picks: [{ account: '1510', confidence: 'high', reason: 'ETH-Konto selbst' }] };
			}
		};
		await askForList({
			txs: [tx({ counterparty: 'Unbekannt', amountCents: 500 })],
			app,
			client,
			store: null,
			learnedName: (v) => v
		});
		expect(listAssist.picks.t1).toEqual({ account: null, confidence: '', reason: '' });
		expect('known' in bodies[0].booking).toBe(false);
	});
});

describe('confirming another account on a rule’s booking', () => {
	/** @type {any} */
	let store;
	beforeEach(async () => {
		store = {};
		for (const name of /** @type {const} */ ([
			'transactions',
			'receipts',
			'matches',
			'questions',
			'settings',
			'accounts',
			'partners',
			'events'
		])) {
			store[name] = memoryCollection(name).collection;
		}
		await setSetting(store.settings, 'datev', { consultantNumber: '1001', vatPeriod: 'month' });
	});

	it('moves the rule’s account in the settings, and the next reward gets it', async () => {
		const t = await store.transactions.put({ ...tx(), id: undefined });
		await confirmBooking(store, t.id, { account: '2750' }, { rule: 'reward' });
		const datev = await getSetting(store.settings, 'datev');
		expect(datev).toMatchObject({ rewardAccount: '2750', vatPeriod: 'month' });
		const next = tx({ id: 't2' });
		expect(
			suggestBooking(next, {
				classification: reward,
				ruleAccounts: { reward: cleanDatevSettings(datev).rewardAccount }
			}).account
		).toBe('2750');
		const events = await store.events.list();
		expect(events.at(-1)).toMatchObject({ action: 'booking', rule: 'reward' });
	});

	it('the same account, or no rule: the settings stay', async () => {
		const t = await store.transactions.put({ ...tx(), id: undefined });
		await confirmBooking(store, t.id, { account: '4960' }, { rule: 'cloud-credits' });
		await confirmBooking(store, t.id, { account: '4900' });
		expect(await getSetting(store.settings, 'datev')).toEqual({
			consultantNumber: '1001',
			vatPeriod: 'month'
		});
	});
});
