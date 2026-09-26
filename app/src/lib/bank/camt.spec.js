import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DOMParser } from '@xmldom/xmldom';

import { camtAmountCents, parseCamt053 } from './camt.js';

const fixture = (/** @type {string} */ name) =>
	readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const parse = (/** @type {string} */ xml) =>
	parseCamt053(xml, { DOMParser: /** @type {any} */ (DOMParser) });

describe('CAMT.053, Revolut-style (camt.053.001.08)', () => {
	const [statement, ...rest] = parse(fixture('camt053-revolut.xml'));

	it('reads the account from Acct', () => {
		expect(rest).toHaveLength(0);
		expect(statement.id).toBe('REV-STMT-TEST-0001');
		expect(statement.account).toEqual({
			iban: 'LT000000000000000001',
			currency: 'EUR',
			name: 'Revolut Testkonto'
		});
	});

	it('reads booked entries only, with Pty-nested names and DtTm dates (and the time)', () => {
		expect(statement.skipped).toBe(1);
		expect(statement.transactions).toEqual([
			{
				sourceId: 'rev-tx-0001',
				date: '2026-09-18',
				bookedAt: '2026-09-18T10:21:07Z',
				valueDate: '2026-09-18',
				amountCents: -1999,
				currency: 'EUR',
				counterpartyName: 'Wolkenspeicher Testdienst Ltd',
				counterpartyIban: '',
				purpose: 'Kartenzahlung Wolkenspeicher Abo',
				endToEndId: '',
				bookingType: 'CARD_PAYMENT',
				bankCode: ''
			},
			{
				sourceId: 'rev-tx-0002',
				date: '2026-09-10',
				valueDate: '2026-09-10',
				amountCents: 150000,
				currency: 'EUR',
				counterpartyName: 'Umbuchung Eigenkonto Test',
				counterpartyIban: 'DE00000000000000004711',
				purpose: 'Aufladung Revolut',
				endToEndId: 'E2E-REV-0002',
				bookingType: 'TRANSFER',
				bankCode: ''
			}
		]);
	});
});

describe('CAMT.053, German bank style (camt.053.001.02, DK)', () => {
	const [statement] = parse(fixture('camt053-german-bank.xml'));

	it('falls back to the servicer name for the account', () => {
		expect(statement.account).toEqual({
			iban: 'DE00000000000000002222',
			currency: 'EUR',
			name: 'Testbank eG'
		});
	});

	it('a direct debit: creditor, all Ustrd lines, EndToEndId, AddtlNtryInf', () => {
		expect(statement.transactions[0]).toEqual({
			sourceId: '2026082200001',
			date: '2026-08-22',
			valueDate: '2026-08-22',
			amountCents: -5259,
			currency: 'EUR',
			counterpartyName: 'Mobilfunk Beispiel GmbH',
			counterpartyIban: 'DE00000000000000003333',
			purpose: 'Kundennr. 4711-0815 Rechnung 2026-08 vom 15.08.2026',
			endToEndId: 'MOBIL-2026-08-4411',
			bookingType: 'Basislastschrift',
			bankCode: ''
		});
	});

	it('a batch entry becomes one transaction per TxDtls, each with its own amount', () => {
		const batch = statement.transactions.slice(1, 3);
		expect(batch.map((t) => [t.sourceId, t.amountCents, t.counterpartyName])).toEqual([
			['2026082800007/1', -12000, 'Druckerei Probelauf KG'],
			['2026082800007/2', -18000, 'Steuerbüro Beispielhaft']
		]);
		expect(batch.reduce((sum, t) => sum + t.amountCents, 0)).toBe(-30000);
	});

	it('a credit: the debtor is the counterparty; no reference means no sourceId', () => {
		const credit = statement.transactions[3];
		expect(credit).toMatchObject({
			sourceId: null,
			amountCents: 119000,
			valueDate: '2026-08-31',
			counterpartyName: 'Kundschaft Probe AG',
			counterpartyIban: 'DE00000000000000006666',
			endToEndId: '',
			bookingType: 'Gutschrift'
		});
		expect(statement.transactions).toHaveLength(4);
		expect(statement.skipped).toBe(0);
	});
});

describe('CAMT.053 errors and amounts', () => {
	it('refuses what is not a statement', () => {
		expect(() => parse('<Document><Foo/></Document>')).toThrow(/CAMT\.053/);
		expect(() =>
			parse(
				'<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Acct><Id/></Acct></Stmt></BkToCstmrStmt></Document>'
			)
		).toThrow(/IBAN/);
	});

	it('amounts with a point, to cents, without floats', () => {
		expect(camtAmountCents('19.99')).toBe(1999);
		expect(camtAmountCents('1500')).toBe(150000);
		expect(camtAmountCents('0.1')).toBe(10);
		expect(() => camtAmountCents('1,50')).toThrow();
		expect(() => camtAmountCents('1.505')).toThrow();
	});
});

describe('CAMT.053, the bank transaction code', () => {
	it('keeps Domn/Fmly/SubFmlyCd as bankCode (a Revolut plan fee: ACMT/MDOP/CHRG)', () => {
		const xml = `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
  <Id>FEE-TEST</Id>
  <Acct><Id><IBAN>LT000000000000000001</IBAN></Id><Ccy>EUR</Ccy></Acct>
  <Ntry>
    <Amt Ccy="EUR">10.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-09-06</Dt></BookgDt>
    <BkTxCd><Domn><Cd>ACMT</Cd><Fmly><Cd>MDOP</Cd><SubFmlyCd>CHRG</SubFmlyCd></Fmly></Domn><Prtry><Cd>FEE</Cd></Prtry></BkTxCd>
    <NtryDtls><TxDtls><Refs><AcctSvcrRef>fee-1</AcctSvcrRef></Refs>
      <RmtInf><Ustrd>Gebühr für das Basic-Abo</Ustrd></RmtInf></TxDtls></NtryDtls>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;
		const [statement] = parse(xml);
		expect(statement.transactions[0]).toMatchObject({
			amountCents: -1000,
			bookingType: 'FEE',
			bankCode: 'ACMT/MDOP/CHRG',
			counterpartyName: ''
		});
	});
});
