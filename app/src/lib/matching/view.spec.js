import { describe, expect, it } from 'vitest';

import { receipt, tx } from './fixtures.js';
import {
	coverageBadge,
	hitCriteria,
	isTxCovered,
	matchOfReceipt,
	matchesOfTx,
	otherPayments,
	privateSearchQuery,
	questionProgress,
	rankHits,
	ownNameCandidate,
	assistCandidates,
	hitScore,
	likelyHit,
	receiptChoices,
	searchAmount
} from './view.js';

describe('coverage', () => {
	it('a receipt, "Kein Beleg nötig" or a classification covers a booking', () => {
		const c = { T2: /** @type {any} */ ({ kind: 'bank-fee' }) };
		expect(isTxCovered({ id: 'T1', receiptId: 'R1' }, c)).toBe(true);
		expect(isTxCovered({ id: 'T2' }, c)).toBe(true);
		expect(isTxCovered({ id: 'T3', noReceipt: { reason: 'x' } }, c)).toBe(true);
		expect(isTxCovered({ id: 'T4' }, c)).toBe(false);
		expect(coverageBadge({ id: 'T1', receiptId: 'R1' }, c)).toBe('receipt');
		expect(coverageBadge({ id: 'T2' }, c)).toBe('bank-fee');
		expect(coverageBadge({ id: 'T3', noReceipt: { reason: 'x' } }, c)).toBe('no-receipt');
		expect(coverageBadge({ id: 'T4' }, c)).toBeNull();
	});
});

describe('matches of a booking and of a receipt', () => {
	const matches = [
		{ id: 'M2', transactionId: 'T1', receiptId: 'R2', state: 'confirmed' },
		{ id: 'M1', transactionId: 'T1', receiptId: 'R1', state: 'auto' },
		{ id: 'M3', transactionId: 'T1', receiptId: 'R3', state: 'rejected' },
		{ id: 'M4', transactionId: 'T2', receiptId: 'R4', state: 'auto', deleted: true }
	];
	it('only active ones, oldest first', () => {
		expect(matchesOfTx('T1', matches).map((m) => m.id)).toEqual(['M1', 'M2']);
		expect(matchesOfTx('T2', matches)).toEqual([]);
		expect(matchOfReceipt('R3', matches)).toBeNull();
		expect(matchOfReceipt('R2', matches)?.id).toBe('M2');
	});
});

describe('receiptChoices', () => {
	it('best fit first, suggestions marked, receipts linked elsewhere left out', () => {
		const t = tx({ bookedOn: '2026-08-22', amountCents: -5259, counterparty: 'Stromwerk Test AG' });
		const fits = receipt({ vendor: 'Stromwerk Test AG', gross: 52.59, invoice_date: '2026-08-18' });
		const other = receipt({
			vendor: 'Papierladen Test KG',
			gross: 23.8,
			invoice_date: '2026-08-18'
		});
		const elsewhere = receipt({ vendor: 'Stromwerk Test AG', gross: 52.59 });
		const unread = { id: 'RX', status: 'neu', extraction: null, amountCents: null };
		const phish = { id: 'RP', status: 'rückfrage' };
		const matches = [{ id: 'M', transactionId: 'T-other', receiptId: elsewhere.id, state: 'auto' }];
		const choices = receiptChoices(t, [other, fits, elsewhere, unread, phish], matches);
		expect(choices.map((c) => c.receipt.id)).toEqual([fits.id, other.id, 'RX']);
		expect(choices.map((c) => c.suggested)).toEqual([true, false, false]);
	});
});

describe('otherPayments', () => {
	it('same counterparty, newest first, not itself', () => {
		const a = tx({ bookedOn: '2026-07-20', counterparty: 'Abosoft Test GmbH' });
		const b = tx({ bookedOn: '2026-08-20', counterparty: 'abosoft test gmbh ' });
		const c = tx({ bookedOn: '2026-09-20', counterparty: 'Abosoft Test GmbH' });
		const d = tx({ bookedOn: '2026-09-21', counterparty: 'Andere' });
		expect(otherPayments(c, [a, b, c, d]).map((t) => t.id)).toEqual([b.id, a.id]);
		expect(otherPayments(tx({ counterparty: '' }), [a])).toEqual([]);
	});
});

describe('private mailbox search', () => {
	it('asks for the counterparty’s telling word, the amount and ± 14 days', () => {
		expect(
			privateSearchQuery(
				tx({ bookedOn: '2026-08-22', amountCents: -5259, counterparty: 'Stromwerk Test AG' })
			)
		).toEqual({ text: 'Stromwerk', amount: '52,59', from: [], around: '2026-08-22', days: 14 });
		// A learned partner adds the domains its receipts came from.
		expect(
			privateSearchQuery(
				tx({ bookedOn: '2026-08-22', amountCents: -1999, counterparty: 'PAYPAL *WOLKENFAB 4029' }),
				[
					{
						name: 'Wolkenfabrik',
						aliases: ['paypal wolkenfab'],
						senderDomains: ['wolkenfabrik.example']
					}
				]
			).from
		).toEqual(['wolkenfabrik.example']);
		expect(
			privateSearchQuery(
				tx({
					bookedOn: '2026-08-22',
					amountCents: -2242,
					counterparty: 'Kaffeerösterei Nordlicht GmbH'
				})
			).text
		).toBe('Kaffeerösterei');
		expect(
			privateSearchQuery(
				tx({
					bookedOn: '2026-08-22',
					amountCents: -1000,
					counterparty: 'GmbH',
					purpose: 'Kartenzahlung 12 Papierladen'
				})
			).text
		).toBe('Papierladen');
		expect(privateSearchQuery(tx({ bookedOn: '2026-08-22', amountCents: -1000 })).text).toBeNull();
		expect(searchAmount(-119000)).toBe('1190,00');
		expect(searchAmount(5)).toBe('0,05');
	});

	it('says which criteria hit, and ranks likely receipts first', () => {
		expect(hitCriteria({ matched: ['"Stromwerk"', '52,59'] })).toEqual(['text', 'amount']);
		expect(hitCriteria({ matched: ['52.59'] })).toEqual(['amount']);
		expect(hitCriteria({})).toEqual([]);
		const news = {
			id: 'news',
			matched: ['"Stromwerk"'],
			attachments: [],
			auth: { verdict: 'pass' },
			receivedAt: '2026-08-21'
		};
		const spam = {
			id: 'spam',
			matched: ['52,59'],
			attachments: [],
			auth: { verdict: 'none' },
			receivedAt: '2026-08-23'
		};
		const bill = {
			id: 'bill',
			matched: ['"Stromwerk"', '52,59'],
			attachments: [{ kind: 'pdf' }],
			auth: { verdict: 'pass' },
			receivedAt: '2026-08-20'
		};
		// The exact amount says more than the word somewhere in the text.
		expect(rankHits([news, spam, bill]).map((h) => h.id)).toEqual(['bill', 'spam', 'news']);
	});
});

describe('questionProgress', () => {
	it('open, settled, all', () => {
		expect(
			questionProgress([
				{ state: 'open' },
				{ state: 'answered' },
				{ state: 'answered' },
				{ state: 'open', deleted: true }
			])
		).toEqual({ open: 1, done: 2, total: 3 });
	});
});

describe('hitScore, rankHits and likelyHit', () => {
	const context = { word: 'Anthropic', around: '2026-09-20' };
	const receipt = {
		id: 'receipt',
		subject: 'Your receipt from Anthropic, PBC #1234',
		from: { address: 'invoice+statements@mail.anthropic.com', name: 'Anthropic, PBC' },
		matched: ['"Anthropic"'],
		attachments: [{ kind: 'pdf', name: 'Invoice-ABC-0003.pdf' }],
		auth: { verdict: 'pass' },
		receivedAt: '2026-09-19T15:00:00Z'
	};
	const signIn = {
		id: 'sign-in',
		subject: 'Dein sicherer Link zu Claude.ai ist da',
		from: { address: 'no-reply-x@mail.anthropic.com', name: 'Anthropic' },
		matched: ['"Anthropic"'],
		attachments: [],
		auth: { verdict: 'pass' },
		receivedAt: '2026-09-19T15:50:00Z'
	};
	const newsletter = {
		id: 'news',
		subject: 'Nobody Will Say Who Sent the Agents',
		from: { address: 'newsletter@aicollective.example', name: 'AI Newsletter' },
		matched: ['"Anthropic"', '180,00'],
		attachments: [],
		auth: { verdict: 'pass' },
		bulk: true,
		receivedAt: '2026-09-07T08:00:00Z'
	};
	const otherBill = {
		id: 'other',
		subject: 'Ihr Versicherungsantrag',
		from: { address: 'vertrag@versicherung.example', name: 'Versicherung' },
		matched: ['180,00'],
		attachments: [{ kind: 'pdf', name: 'Rechnung.pdf' }],
		auth: { verdict: 'pass' },
		receivedAt: '2026-09-07T08:00:00Z'
	};
	it('a hit from a known sender domain counts as "known-sender"', () => {
		const h = { ...otherBill, matched: ['@versicherung.example'] };
		expect(hitCriteria(h)).toEqual(['sender']);
		expect(hitScore(h, context).why).toContain('known-sender');
	});
	it("the vendor's receipt with a PDF comes first; sign-in mails and newsletters sink", () => {
		const ranked = rankHits([signIn, newsletter, otherBill, receipt], context);
		expect(ranked.map((h) => h.id)).toEqual(['receipt', 'other', 'sign-in', 'news']);
		expect(hitScore(signIn, context).why).toContain('sign-in');
		expect(hitScore(newsletter, context).why).toContain('newsletter');
		expect(likelyHit(ranked, context)?.id).toBe('receipt');
	});
	it('a failed-payment notice sinks below the receipt that came with the retry', () => {
		const failed = {
			id: 'failed',
			subject: '[GitHub] We had a problem billing your account',
			from: { address: 'noreply@github.com', name: 'GitHub' },
			matched: ['"Github"'],
			attachments: [],
			auth: { verdict: 'pass' },
			receivedAt: '2026-06-08T08:00:00Z'
		};
		const receiptMail = {
			...failed,
			id: 'receipt',
			subject: '[GitHub] Payment receipt for your account',
			receivedAt: '2026-06-10T08:00:00Z'
		};
		const gh = { word: 'Github', around: '2026-06-10' };
		expect(hitScore(failed, gh).why).toContain('payment-failed');
		expect(rankHits([failed, receiptMail], gh).map((h) => h.id)).toEqual(['receipt', 'failed']);
	});

	it('no clear winner: no likely hit', () => {
		expect(likelyHit(rankHits([signIn, newsletter], context), context)).toBeNull();
		expect(likelyHit([], context)).toBeNull();
	});
});

describe('ownNameCandidate', () => {
	const away = tx({
		id: 'A',
		accountId: 'ACC-GLS',
		bookedOn: '2026-07-18',
		amountCents: -20000,
		counterparty: 'LE SPACE UG (HAFTUNGSBESCHRAENKT)',
		purpose: 'Claude Code (KI)'
	});
	const into = tx({
		id: 'B',
		accountId: 'ACC-REV',
		bookedOn: '2026-07-19',
		amountCents: 20000,
		counterparty: 'LE SPACE UG (HAFTUNGSBESCHRAENKT)',
		purpose: 'Claude Code (KI)'
	});
	it('the same name on both sides of opposite amounts: ask', () => {
		expect(ownNameCandidate(into, [away, into])).toMatchObject({
			name: 'LE SPACE UG (HAFTUNGSBESCHRAENKT)',
			other: { id: 'A' }
		});
	});
	it('not when the name is known, the other side is missing, far away or on the same account', () => {
		expect(ownNameCandidate(into, [away, into], ['le space UG'])).toBeNull();
		expect(ownNameCandidate(into, [into])).toBeNull();
		expect(ownNameCandidate(into, [{ ...away, bookedOn: '2026-07-30' }, into])).toBeNull();
		expect(ownNameCandidate(into, [{ ...away, accountId: 'ACC-REV' }, into])).toBeNull();
	});
});

describe('assistCandidates', () => {
	it('nearest by amount, then by date; read fields only; capped', () => {
		const t = tx({ bookedOn: '2026-09-20', amountCents: -1999 });
		const r = (
			/** @type {string} */ id,
			/** @type {number} */ cents,
			/** @type {string} */ date
		) => ({
			receipt: {
				id,
				amountCents: cents,
				currency: 'EUR',
				documentDate: date,
				vendor: `Anbieter ${id}`,
				invoiceNumber: `N-${id}`,
				extraction: { summary: 'Test', vendor: `Anbieter ${id}` },
				excerpt: 'geheimer Mailtext'
			}
		});
		const out = assistCandidates(
			t,
			[r('A', 5000, '2026-09-19'), r('B', 1999, '2026-06-01'), r('C', 1999, '2026-09-18')],
			2
		);
		expect(out.map((c) => c.id)).toEqual(['C', 'B']);
		expect(out[0]).toEqual({
			id: 'C',
			vendor: 'Anbieter C',
			amount: '19,99',
			currency: 'EUR',
			date: '2026-09-18',
			number: 'N-C',
			summary: 'Test'
		});
		expect(JSON.stringify(out)).not.toContain('geheimer Mailtext');
	});
});
