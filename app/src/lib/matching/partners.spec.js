// Learning from a person's links: the counterparty on the statement is the
// vendor on the receipt, next month too.
import { beforeEach, describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { setSetting } from '../store/settings.js';
import { receipt, tx } from './fixtures.js';
import { confirmMatch } from './actions.js';
import { runMatching } from './engine.js';
import {
	aliasLabel,
	counterpartyKey,
	txAlias,
	learnFromLink,
	learnedVendors,
	mailDomain,
	partnerOfTx
} from './partners.js';
import { receiptFacts, scorePair, txFacts } from './score.js';

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
		'partners'
	])) {
		store[name] = memoryCollection(name).collection;
	}
	await setSetting(store.settings, 'matching', { companyNames: ['le space UG'] });
});

/** @param {'transactions' | 'receipts'} name @param {Record<string, any>} record */
async function add(name, record) {
	const rest = { ...record };
	delete rest.id;
	return store[name].put(rest);
}

const PAYPAL = 'PAYPAL *WOLKENFAB 4029357733';

describe('counterpartyKey and mailDomain', () => {
	it('drops digits, punctuation and case; keeps the words', () => {
		expect(counterpartyKey(PAYPAL)).toBe('paypal wolkenfab');
		expect(counterpartyKey('PAYPAL *WOLKENFAB 4029351111')).toBe(counterpartyKey(PAYPAL));
		expect(counterpartyKey('Anthropic* Claude Sub')).toBe('anthropic claude sub');
		expect(counterpartyKey('')).toBe('');
	});
	it('the domain of a sender', () => {
		expect(mailDomain('Anthropic, PBC <invoice+statements@mail.anthropic.com>')).toBe(
			'mail.anthropic.com'
		);
		expect(mailDomain('rechnung@wolkenfabrik.example')).toBe('wolkenfabrik.example');
		expect(mailDomain('no address')).toBeNull();
	});
});

describe('txAlias', () => {
	it('a wallet booking is known by the other address, the same on every EVM chain', () => {
		const addr = '0xAbCd000000000000000000000000000000001234';
		expect(txAlias({ source: 'ethereum', counterpartyAddress: addr, counterparty: addr })).toBe(
			`addr:evm:${addr.toLowerCase()}`
		);
		expect(txAlias({ source: 'base', counterpartyAddress: addr })).toBe(
			`addr:evm:${addr.toLowerCase()}`
		);
		expect(txAlias({ source: 'nyx', counterpartyAddress: 'n1abc' })).toBe('addr:nyx:n1abc');
		// A bank booking: the counterparty key, as before.
		expect(txAlias({ source: 'hibiscus', counterparty: 'PAYPAL *WOLKENFAB 4029' })).toBe(
			'paypal wolkenfab'
		);
		expect(aliasLabel(`addr:evm:${addr.toLowerCase()}`)).toBe('0xabcd00…001234');
		expect(aliasLabel('paypal wolkenfab')).toBe('paypal wolkenfab');
	});

	it('a link on a wallet payment teaches the address; the next payment there scores the vendor', async () => {
		const VENDOR = 'n1madeupvendor00000000000000000000000zzzz';
		const pay = (/** @type {string} */ day) =>
			tx({
				source: 'nyx',
				bookedOn: day,
				amountCents: -3370,
				counterparty: VENDOR,
				counterpartyAddress: VENDOR
			});
		const first = await add('transactions', pay('2026-03-25'));
		const bill = await add(
			'receipts',
			receipt({ vendor: 'Beispiel VPN Ltd', gross: 33.7, invoice_date: '2026-03-25' })
		);
		await confirmMatch(store, { receiptId: bill.id, transactionId: first.id });
		const [partner] = await store.partners.list();
		expect(partner.aliases).toEqual([`addr:nyx:${VENDOR}`]);
		expect(partnerOfTx([partner], pay('2026-04-25'))?.name).toBe('Beispiel VPN Ltd');
		const learned = learnedVendors([partner]);
		const facts = txFacts(pay('2026-04-25'), /** @type {any} */ ({ learnedVendors: learned }));
		expect(facts.learnedVendors).toEqual(['Beispiel VPN Ltd']);
	});
});

describe('learning from a link', () => {
	it('a hand-made link teaches the alias and the sender domain; next month scores "vendor-learned"', async () => {
		const aug = await add(
			'transactions',
			tx({ bookedOn: '2026-08-20', amountCents: -1999, counterparty: PAYPAL })
		);
		const bill = await add(
			'receipts',
			receipt(
				{ vendor: 'Wolkenfabrik Hosting GmbH', gross: 19.99, invoice_date: '2026-08-19' },
				{ from: 'Wolkenfabrik <rechnung@wolkenfabrik.example>' }
			)
		);
		// Before: the names do not meet.
		expect(scorePair(/** @type {any} */ (receiptFacts(bill)), txFacts(aug)).reasons).not.toContain(
			'vendor'
		);

		await confirmMatch(store, { receiptId: bill.id, transactionId: aug.id });
		const [partner] = await store.partners.list();
		expect(partner).toMatchObject({
			name: 'Wolkenfabrik Hosting GmbH',
			aliases: ['paypal wolkenfab'],
			senderDomains: ['wolkenfabrik.example']
		});

		const sep = await add(
			'transactions',
			tx({
				bookedOn: '2026-09-20',
				amountCents: -1999,
				counterparty: 'PAYPAL *WOLKENFAB 4029351111'
			})
		);
		const next = await add(
			'receipts',
			receipt({ vendor: 'Wolkenfabrik Hosting GmbH', gross: 19.99, invoice_date: '2026-09-19' })
		);
		const ctx = { learnedVendors: learnedVendors(await store.partners.list()) };
		const s = scorePair(/** @type {any} */ (receiptFacts(next)), txFacts(sep, ctx));
		expect(s.reasons).toContain('vendor-learned');
		expect(partnerOfTx(await store.partners.list(), sep)?.name).toBe('Wolkenfabrik Hosting GmbH');

		// The engine reads the partners too: the learned name counts in its run.
		await runMatching({ store, now: new Date('2026-09-25T12:00:00Z') });
		const auto = (await store.matches.list()).find(
			(/** @type {any} */ m) => m.transactionId === sep.id
		);
		expect(auto).toMatchObject({ receiptId: next.id, state: 'auto', score: 90 });
		expect(auto.reasons).toEqual(['amount', 'vendor-learned', 'date']);
	});

	it('a learned vendor billing the same amount every month: only the lead decides, as for any name', async () => {
		const t = await add(
			'transactions',
			tx({ bookedOn: '2026-09-20', amountCents: -1999, counterparty: PAYPAL })
		);
		const aug = receipt({
			vendor: 'Wolkenfabrik Hosting GmbH',
			gross: 19.99,
			invoice_date: '2026-08-19'
		});
		const sep = receipt({
			vendor: 'Wolkenfabrik Hosting GmbH',
			gross: 19.99,
			invoice_date: '2026-09-19'
		});
		await learnFromLink(store.partners, aug, { counterparty: PAYPAL });
		const ctx = { learnedVendors: learnedVendors(await store.partners.list()) };
		const facts = txFacts(t, ctx);
		// September's receipt 90, August's 80 on the same booking: 10 ahead is not 30.
		expect(scorePair(/** @type {any} */ (receiptFacts(sep)), facts).score).toBe(90);
		expect(scorePair(/** @type {any} */ (receiptFacts(aug)), facts).score).toBe(80);
	});

	it('learns nothing for our own invoice, a receipt without vendor or a counterparty that is only a legal form; a failed sender check gives no domain', async () => {
		const ours = receipt({ vendor: 'Le Space UG', gross: 100 });
		expect(
			await learnFromLink(
				store.partners,
				ours,
				{ counterparty: 'Kunde AG' },
				{
					companyNames: ['le space UG']
				}
			)
		).toBeNull();
		expect(
			await learnFromLink(store.partners, receipt({ vendor: '' }), { counterparty: 'X GmbH' })
		).toBeNull();
		expect(
			await learnFromLink(store.partners, receipt({ vendor: 'Y GmbH' }), { counterparty: '' })
		).toBeNull();
		const unverified = receipt(
			{ vendor: 'Z GmbH' },
			{ authVerdict: 'fail', from: 'z@evil.example' }
		);
		expect(await learnFromLink(store.partners, unverified, { counterparty: 'Z GMBH' })).toBeNull();
		const p = await learnFromLink(store.partners, unverified, { counterparty: 'ZETT GMBH' });
		expect(p).toMatchObject({ aliases: ['zett gmbh'], senderDomains: [] });
	});

	it('the same link twice writes once', async () => {
		const r = receipt({ vendor: 'Stromwerk Test AG' });
		const t = { counterparty: 'STROMWERK' };
		const first = await learnFromLink(store.partners, r, t);
		const again = await learnFromLink(store.partners, r, t);
		expect(again?.updatedAt).toBe(first?.updatedAt);
		expect(await store.partners.list()).toHaveLength(1);
	});
});
