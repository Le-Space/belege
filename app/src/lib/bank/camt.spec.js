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
		expect(statement.account).toMatchObject({
			iban: 'LT000000000000000001',
			otherId: '',
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
		expect(statement.account).toMatchObject({
			iban: 'DE00000000000000002222',
			otherId: '',
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

describe('CAMT, the sender of a credit (#176)', () => {
	/** @param {string} acct the DbtrAcct/Id content */
	const credit = (acct) => `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt><Stmt>
  <Id>CREDIT-TEST</Id>
  <Acct><Id><IBAN>DE00000000000000000002</IBAN></Id><Ccy>EUR</Ccy></Acct>
  <Ntry>
    <Amt Ccy="EUR">100.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
    <BookgDt><Dt>2026-03-14</Dt></BookgDt>
    <NtryDtls><TxDtls><Refs><AcctSvcrRef>in-1</AcctSvcrRef></Refs>
      <RltdPties><Dbtr><Pty><Nm>Beispiel UG</Nm></Pty></Dbtr><DbtrAcct><Id>${acct}</Id></DbtrAcct></RltdPties>
      <RmtInf><Ustrd>Abo Werkzeug</Ustrd></RmtInf></TxDtls></NtryDtls>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;

	it('its IBAN, or one given under Othr; anything else under Othr is none', () => {
		expect(
			parse(credit('<IBAN>DE00 0000 0000 0000 0000 01</IBAN>'))[0].transactions[0].counterpartyIban
		).toBe('DE00000000000000000001');
		expect(
			parse(credit('<Othr><Id>DE00000000000000000001</Id></Othr>'))[0].transactions[0]
				.counterpartyIban
		).toBe('DE00000000000000000001');
		expect(
			parse(credit('<Othr><Id>12345678</Id></Othr>'))[0].transactions[0].counterpartyIban
		).toBe('');
	});
});

describe('CAMT.053 from Wise: no IBAN, no transaction details (#218)', () => {
	const [statement] = parse(fixture('camt053-wise.xml'));
	const byId = Object.fromEntries(statement.transactions.map((t) => [t.sourceId, t]));

	it('takes the account by its other id, with issuer, scheme and currency', () => {
		expect(statement.account).toEqual({
			iban: '',
			otherId: '10000042',
			issuer: 'Wise Example SA',
			scheme: 'Wise balance id',
			currency: 'EUR',
			name: 'Wise Example SA EUR'
		});
		expect(statement.transactions).toHaveLength(5);
		expect(statement.skipped).toBe(1);
	});

	it('an entry without details: the code as its id, the line as its purpose, the kind as its type', () => {
		expect(byId['TRANSFER-1000001']).toMatchObject({
			date: '2026-01-05',
			bookedAt: '2026-01-05T09:15:00.000000+00:00',
			amountCents: 200_00,
			purpose: 'Topped up account',
			bookingType: 'TRANSFER',
			counterpartyName: ''
		});
	});

	it('a card payment names its merchant; one in another currency keeps that amount and the rate', () => {
		expect(byId['CARD-2000001']).toMatchObject({
			amountCents: -11_50,
			currency: 'EUR',
			counterpartyName: 'Example Cloud Shop',
			bookingType: 'CARD',
			txRef: 'CARD-2000001',
			original: { amount: '12.35', currency: 'USD', rate: '1.07391' }
		});
		// Paid in the account's currency: nothing to keep beside the amount.
		expect(byId['CARD-2000002'].counterpartyName).toBe('Musterladen Berlin');
		expect(byId['CARD-2000002'].original).toBeUndefined();
	});

	it('a fee is a fee, tied to the payment it names; cashback comes from Wise', () => {
		expect(byId['FEE-CARD-2000001']).toMatchObject({
			amountCents: -6,
			bookingType: 'FEE',
			counterpartyName: 'Wise',
			txRef: 'CARD-2000001'
		});
		expect(byId['0123456789abcdef0123456789abcdef']).toMatchObject({
			amountCents: 35,
			counterpartyName: 'Wise',
			purpose: 'Cashback'
		});
	});

	it('another bank’s entry without details stays plain: no merchant guessed', () => {
		const other = fixture('camt053-wise.xml').replaceAll('Wise Example SA', 'Andere Bank AG');
		const [s] = parse(other);
		const card = s.transactions.find((t) => t.sourceId === 'CARD-2000001');
		expect(card).toMatchObject({
			counterpartyName: '',
			purpose: 'Card transaction of 12.35 USD issued by Example Cloud Shop',
			bookingType: 'CARD'
		});
		expect(card?.txRef).toBeUndefined();
	});

	it('still refuses a statement that names no account at all', () => {
		const none = fixture('camt053-wise.xml').replace(/<Othr>[\s\S]*?<\/Othr>/, '');
		expect(() => parse(none)).toThrow(/IBAN/);
	});
});
