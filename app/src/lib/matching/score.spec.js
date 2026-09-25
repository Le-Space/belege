// Scoring and assignment, replaying the phase-0 cases with synthetic twins.
import { describe, expect, it } from 'vitest';

import { receipt, tx } from './fixtures.js';
import { nameOverlap, normalizeRef, sameVendor, vendorWords } from './normalize.js';
import {
	CANDIDATE,
	LEAD,
	SURE,
	assign,
	rankTransactions,
	receiptFacts,
	scorePair,
	txFacts,
	verdict
} from './score.js';

const COMPANY = { companyNames: ['le space UG'] };

/** @param {Record<string, any>} r @param {Record<string, any>} t */
const score = (r, t, ctx = COMPANY) => {
	const facts = receiptFacts(r, ctx);
	if (!facts) throw new Error('no facts');
	return scorePair(facts, txFacts(t));
};

describe('normalize', () => {
	it('strips separators from references, so pdf.js spacing does not matter', () => {
		expect(normalizeRef('ZIVYFQIJ-0002')).toBe(normalizeRef('ZIVYFQIJ 0002'));
		expect(normalizeRef('RE 2026/004')).toBe('re2026004');
		expect(normalizeRef('Größe-Ä')).toBe('grossea');
	});

	it('drops legal forms and fillers from vendor names', () => {
		expect(vendorWords('Wolkenfabrik Hosting GmbH')).toEqual(['wolkenfabrik', 'hosting']);
		expect(vendorWords('Softwareabo Muster Ltd.')).toEqual(['softwareabo', 'muster']);
		expect(nameOverlap('Stromwerk Test AG', 'STROMWERK TEST AG SAGT DANKE')).toBe(1);
		expect(nameOverlap('Wolkenfabrik GmbH', 'Papierladen GmbH')).toBe(0);
		expect(nameOverlap('GmbH', 'AG')).toBe(0);
	});

	it('same vendor: a shared generic word is not enough', () => {
		expect(sameVendor('Stromwerk Test AG', 'Kaffeerösterei Test')).toBe(false);
		expect(sameVendor('Stromwerk Test AG', 'STROMWERK')).toBe(true);
		expect(sameVendor('Sage GmbH', 'SAGE GMBH')).toBe(true);
		expect(sameVendor('Wolkenfabrik Hosting GmbH', 'Wolkenfabrik Rechenzentrum')).toBe(true);
		expect(sameVendor('Abosoft Test GmbH', 'Abosoft Test GmbH')).toBe(true);
		expect(sameVendor('', 'x')).toBe(false);
	});
});

describe('scorePair', () => {
	const invoice = receipt({
		vendor: 'Wolkenfabrik Hosting GmbH',
		invoice_number: 'WF-2026-0815',
		invoice_date: '2026-08-13',
		gross: 119
	});

	it('adds amount, invoice number, vendor and date', () => {
		const s = score(
			invoice,
			tx({
				bookedOn: '2026-08-17',
				amountCents: -11900,
				counterparty: 'Wolkenfabrik Hosting GmbH',
				purpose: 'Rechnung WF 2026 0815 Kunde 1'
			})
		);
		expect(s.reasons).toEqual(['amount', 'invoice-number', 'vendor', 'date']);
		expect(s.score).toBe(120);
	});

	it('finds the invoice number in the end-to-end id too', () => {
		const s = score(
			invoice,
			tx({ bookedOn: '2026-08-17', amountCents: -11900, endToEndId: 'WF2026-0815' })
		);
		expect(s.reasons).toContain('invoice-number');
	});

	it('needs the same currency for the amount to count', () => {
		const s = score(invoice, tx({ bookedOn: '2026-08-17', amountCents: -11900, currency: 'USD' }));
		expect(s.reasons).not.toContain('amount');
	});

	it('ignores references too short to mean anything', () => {
		const short = receipt({
			vendor: 'X',
			invoice_number: 'A-12',
			gross: 5,
			invoice_date: '2026-08-01'
		});
		const s = score(
			short,
			tx({ bookedOn: '2026-08-02', amountCents: -500, purpose: 'Rechnung A12' })
		);
		expect(s.reasons).not.toContain('invoice-number');
	});

	it('matches the vendor IBAN by its last four digits, or in full', () => {
		const last4 = receipt({
			vendor: 'Stromwerk Test AG',
			gross: 52.59,
			iban_last4: '0099',
			invoice_date: '2026-08-01'
		});
		const t = tx({
			bookedOn: '2026-08-05',
			amountCents: -5259,
			counterpartyIban: 'DE00 1234 5678 0000 0000 99'
		});
		expect(score(last4, t).reasons).toContain('iban');
		const full = receipt({
			vendor: 'Stromwerk Test AG',
			gross: 52.59,
			vendor_iban: 'DE00123456780000000099'
		});
		expect(score(full, t).reasons).toContain('iban');
		const other = receipt({
			vendor: 'Stromwerk Test AG',
			gross: 52.59,
			vendor_iban: 'DE00123456780000000011'
		});
		expect(score(other, t).reasons).not.toContain('iban');
	});

	it('reads the counterparty IBAN from the purpose when the field is empty', () => {
		const r = receipt({ vendor: 'Softwareabo Muster Ltd', gross: 7.47, iban_last4: '0001' });
		const t = tx({
			amountCents: -747,
			purpose: 'EREF+ABO-0814 SVWZ+Abo August IBAN+IE00ABCD00000000000001'
		});
		expect(score(r, t).reasons).toContain('iban');
	});

	it('gives half the vendor points when the name shows only in the purpose (card payment)', () => {
		const r = receipt({ vendor: 'Papierladen Test KG', gross: 23.8, invoice_date: '2026-08-10' });
		const s = score(
			r,
			tx({
				bookedOn: '2026-08-10',
				amountCents: -2380,
				counterparty: 'Kartenumsatz',
				purpose: 'PAPIERLADEN TEST//BEISPIELSTADT'
			})
		);
		expect(s.reasons).toEqual(['amount', 'vendor-in-purpose', 'date']);
		expect(s.score).toBe(60);
	});

	it('uses the date window: invoice −5 … due/debit date +10, a penalty beyond 60 days', () => {
		const r = receipt({
			vendor: 'Sage Test GmbH',
			gross: 7.47,
			invoice_date: '2026-08-13',
			due_or_debit_date: '2026-09-17'
		});
		const at = (/** @type {string} */ d) => score(r, tx({ bookedOn: d, amountCents: -747 }));
		expect(at('2026-08-08').reasons).toContain('date');
		expect(at('2026-08-07').reasons).not.toContain('date');
		expect(at('2026-09-27').reasons).toContain('date');
		expect(at('2026-09-28').reasons).not.toContain('date');
		expect(at('2026-11-27').reasons).toContain('far-date');
		expect(at('2026-06-01').reasons).toContain('far-date');
	});

	it('falls back to the day the mail came when the document has no date', () => {
		const r = receipt(
			{ vendor: 'Undatiert Test', gross: 10 },
			{ receivedAt: '2026-08-20T08:00:00Z', documentDate: null }
		);
		expect(score(r, tx({ bookedOn: '2026-08-22', amountCents: -1000 })).reasons).toContain('date');
	});

	it('penalises incoming money for an expense', () => {
		const s = score(invoice, tx({ bookedOn: '2026-08-17', amountCents: 11900 }));
		expect(s.reasons).toContain('wrong-direction');
		expect(s.score).toBe(40 + 10 - 40);
	});

	it('expects incoming money for our own invoice, and for a vendor credit note', () => {
		const ours = receipt({
			vendor: 'le space UG (haftungsbeschränkt)',
			invoice_number: '2026-004',
			gross: 1439.76,
			invoice_date: '2026-09-10'
		});
		expect(receiptFacts(ours, COMPANY)?.direction).toBe('income');
		const paid = score(
			ours,
			tx({
				bookedOn: '2026-09-22',
				amountCents: 143976,
				counterparty: 'Kundin Beispiel AG',
				purpose: 'Rechnung 2026-004'
			})
		);
		expect(paid.reasons).toEqual(['amount', 'invoice-number', 'date']);
		expect(paid.score).toBe(100);

		const credit = receipt({
			document_type: 'invoice',
			vendor: 'Wolkenfabrik Hosting GmbH',
			gross: -19,
			invoice_date: '2026-09-01'
		});
		expect(receiptFacts(credit, COMPANY)?.direction).toBe('income');
		const refund = score(
			credit,
			tx({ bookedOn: '2026-09-03', amountCents: 1900, counterparty: 'Wolkenfabrik Hosting GmbH' })
		);
		expect(refund.reasons).toEqual(['amount', 'vendor', 'date']);
		const wrong = score(
			credit,
			tx({ bookedOn: '2026-09-03', amountCents: -1900, counterparty: 'Wolkenfabrik Hosting GmbH' })
		);
		expect(wrong.reasons).toContain('wrong-direction');
	});

	it('has no facts for a receipt without an amount', () => {
		expect(receiptFacts(receipt({ gross: null }))).toBeNull();
	});
});

describe('verdict', () => {
	it('sure at ≥ 90 with a lead of ≥ 30, unsure otherwise, none below 50', () => {
		expect(verdict([{ score: SURE }, { score: SURE - LEAD }])).toBe('sicher');
		expect(verdict([{ score: SURE }, { score: SURE - LEAD + 1 }])).toBe('unsicher');
		expect(verdict([{ score: SURE - 1 }])).toBe('unsicher');
		expect(verdict([{ score: CANDIDATE - 1 }])).toBe('keiner');
		expect(verdict([])).toBe('keiner');
	});
});

describe('assign: the phase-0 cases', () => {
	/** @param {any[]} receipts @param {any[]} txs @param {any} [excluded] */
	const run = (receipts, txs, excluded) =>
		assign({
			receipts: receipts.map((r) => /** @type {any} */ (receiptFacts(r, COMPANY))),
			transactions: txs.map((t) => txFacts(t)),
			excluded
		});

	it('monthly equal amounts: the invoice number decides (Sage)', () => {
		const aug = receipt({
			vendor: 'Abosoft Test GmbH',
			invoice_number: 'AS-2026-081301',
			invoice_date: '2026-08-13',
			due_or_debit_date: '2026-09-17',
			gross: 7.47
		});
		const notice = receipt({
			document_type: 'direct_debit_notice',
			vendor: 'Abosoft Test GmbH',
			invoice_number: 'AS-2026-071501',
			invoice_date: '2026-07-15',
			due_or_debit_date: '2026-08-20',
			gross: 7.47
		});
		const debitAug = tx({
			bookedOn: '2026-08-20',
			amountCents: -747,
			counterparty: 'Abosoft Test GmbH',
			purpose: 'AS2026071501 Abo'
		});
		const debitSep = tx({
			bookedOn: '2026-09-17',
			amountCents: -747,
			counterparty: 'Abosoft Test GmbH',
			purpose: 'AS 2026 081301 Abo'
		});
		const result = run([aug, notice], [debitAug, debitSep]);
		expect(result.sure).toEqual([
			expect.objectContaining({ receiptId: aug.id, transactionId: debitSep.id }),
			expect.objectContaining({ receiptId: notice.id, transactionId: debitAug.id })
		]);
		expect(result.unsure).toEqual([]);
	});

	it('monthly equal amounts without an invoice number in the purpose: nobody is sure', () => {
		const a = receipt({
			vendor: 'Abosoft Test GmbH',
			invoice_date: '2026-08-13',
			gross: 7.47,
			iban_last4: '0042'
		});
		const t1 = tx({
			bookedOn: '2026-08-14',
			amountCents: -747,
			counterparty: 'Abosoft Test GmbH',
			counterpartyIban: 'DE00000000000000000042'
		});
		const t2 = tx({
			bookedOn: '2026-08-15',
			amountCents: -747,
			counterparty: 'Abosoft Test GmbH',
			counterpartyIban: 'DE00000000000000000042'
		});
		const result = run([a], [t1, t2]);
		expect(result.sure).toEqual([]);
		expect(result.unsure[0].candidates.map((c) => c.transactionId)).toEqual([t1.id, t2.id]);
	});

	it('bank transfer with our customer number in the reference (Cyberport)', () => {
		const r = receipt({
			vendor: 'Technikversand Test GmbH',
			invoice_number: '9912345',
			customer_number: 'KD-4455667',
			invoice_date: '2026-08-02',
			gross: 1190
		});
		const t = tx({
			bookedOn: '2026-08-04',
			amountCents: -119000,
			counterparty: 'Technikversand Test GmbH',
			bookingType: 'Überweisungsauftrag',
			purpose: 'Kundennummer KD-4455667 Danke'
		});
		const result = run([r], [t]);
		expect(result.sure).toHaveLength(1);
		expect(result.sure[0].reasons).toEqual(['amount', 'customer-number', 'vendor', 'date']);
		expect(result.sure[0].score).toBe(90);
	});

	it('card payment from another bank: no match on this account is right (Anthropic via Revolut)', () => {
		const r = receipt({
			vendor: 'Sprachmodell Labs PBC',
			invoice_number: 'SLX-0002',
			invoice_date: '2026-08-05',
			gross: 21.42,
			currency: 'USD',
			payment: 'card'
		});
		const topUp = tx({
			bookedOn: '2026-08-03',
			amountCents: -50000,
			counterparty: 'le space UG',
			purpose: 'Umbuchung Revolut'
		});
		const result = run([r], [topUp]);
		expect(result.sure).toEqual([]);
		expect(result.unsure).toEqual([]);
		expect(result.none).toEqual([r.id]);
	});

	it('incoming payment naming our outgoing invoice number', () => {
		const ours = receipt(
			{
				vendor: 'le space UG',
				invoice_number: '2026-004',
				invoice_date: '2026-09-10',
				gross: 1439.76
			},
			{ outgoing: true }
		);
		const expense = tx({ bookedOn: '2026-09-12', amountCents: -143976, counterparty: 'Irgendwer' });
		const income = tx({
			bookedOn: '2026-09-22',
			amountCents: 143976,
			counterparty: 'Kundin Beispiel AG',
			purpose: 'Rechnung 2026-004',
			bookingType: 'Gutschrift'
		});
		const result = run([ours], [expense, income]);
		expect(result.sure).toEqual([
			expect.objectContaining({ receiptId: ours.id, transactionId: income.id })
		]);
	});

	it('a payment reminder never takes a booking, and does not block its invoice', () => {
		const invoice = receipt({
			vendor: 'Stromwerk Test AG',
			invoice_number: 'SW-4711-01',
			invoice_date: '2026-08-01',
			gross: 52.59
		});
		const reminder = receipt({
			document_type: 'payment_reminder',
			vendor: 'Stromwerk Test AG',
			invoice_number: 'SW-4711-01',
			invoice_date: '2026-08-20',
			gross: 52.59
		});
		const t = tx({
			bookedOn: '2026-08-22',
			amountCents: -5259,
			counterparty: 'Stromwerk Test AG',
			purpose: 'SW471101'
		});
		const result = run([invoice, reminder], [t]);
		expect(result.sure).toEqual([
			expect.objectContaining({ receiptId: invoice.id, transactionId: t.id })
		]);
		const alone = run([reminder], [t]);
		expect(alone.sure).toEqual([]);
	});

	it('two receipts for one booking: neither is sure unless one leads by 30', () => {
		const a = receipt({
			vendor: 'Wolkenfabrik Hosting GmbH',
			invoice_number: 'WF-100001',
			invoice_date: '2026-08-01',
			gross: 119
		});
		const b = receipt({
			vendor: 'Wolkenfabrik Hosting GmbH',
			invoice_number: 'WF-100002',
			invoice_date: '2026-08-01',
			gross: 119
		});
		const t = tx({
			bookedOn: '2026-08-03',
			amountCents: -11900,
			counterparty: 'Wolkenfabrik Hosting GmbH',
			purpose: 'WF100001 WF100002'
		});
		expect(run([a, b], [t]).sure).toEqual([]);
		const onlyA = tx({
			bookedOn: '2026-08-03',
			amountCents: -11900,
			counterparty: 'Wolkenfabrik Hosting GmbH',
			purpose: 'WF100001'
		});
		expect(run([a, b], [onlyA]).sure).toEqual([expect.objectContaining({ receiptId: a.id })]);
	});

	it('leaves out pairs a person rejected', () => {
		const r = receipt({
			vendor: 'Wolkenfabrik Hosting GmbH',
			invoice_number: 'WF-100001',
			invoice_date: '2026-08-01',
			gross: 119
		});
		const t = tx({ bookedOn: '2026-08-03', amountCents: -11900, purpose: 'WF100001' });
		const result = run(
			[r],
			[t],
			(/** @type {string} */ rid, /** @type {string} */ tid) => rid === r.id && tid === t.id
		);
		expect(result.sure).toEqual([]);
		expect(result.none).toEqual([r.id]);
		expect(result.unmatched).toEqual([{ transactionId: t.id, candidates: [] }]);
	});

	it('ranks a receipt’s transactions best first', () => {
		const r = receipt({
			vendor: 'Wolkenfabrik Hosting GmbH',
			gross: 119,
			invoice_date: '2026-08-01'
		});
		const good = tx({ bookedOn: '2026-08-02', amountCents: -11900, counterparty: 'Wolkenfabrik' });
		const worse = tx({ bookedOn: '2026-08-02', amountCents: -11900 });
		const ranked = rankTransactions(
			/** @type {any} */ (receiptFacts(r)),
			[worse, good].map((t) => txFacts(t))
		);
		expect(ranked.map((c) => c.transactionId)).toEqual([good.id, worse.id]);
	});
});
