// A made-up CAMT.053 with one booking: how the agent enters a booking through
// the production UI (Integrationen → Bank → "CAMT.053-Datei wählen"), which has
// no form for typing a payment in and no test button.
//
// Nothing here is real: the IBANs carry check digits 00, the names are the
// repository's usual made-up ones, the amounts are small and round-ish.

/**
 * @param {{ runId: string, iban: string, owner: string, counterparty: string, amount: string, purpose: string, date?: string }} booking
 *   amount: positive decimal string with a dot, booked as a debit (money going out)
 * @returns {{ name: string, mimeType: string, buffer: Buffer }}
 */
export function madeUpStatement({ runId, iban, owner, counterparty, amount, purpose, date }) {
	const day = date ?? new Date().toISOString().slice(0, 10);
	const ref = `REMOTE-${runId}-${iban.slice(-4)}`.slice(0, 35);
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Made up for the remote collaboration test (e2e-remote/statement.mjs). -->
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr>
      <MsgId>${ref}-MSG</MsgId>
      <CreDtTm>${day}T08:00:00+00:00</CreDtTm>
    </GrpHdr>
    <Stmt>
      <Id>${ref}-STMT</Id>
      <CreDtTm>${day}T08:00:00+00:00</CreDtTm>
      <Acct>
        <Id><IBAN>${iban}</IBAN></Id>
        <Ccy>EUR</Ccy>
        <Ownr><Nm>${owner}</Nm></Ownr>
        <Svcr><FinInstnId><BIC>TESTDEFFXXX</BIC><Nm>Testbank eG</Nm></FinInstnId></Svcr>
      </Acct>
      <Ntry>
        <Amt Ccy="EUR">${amount}</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>${day}</Dt></BookgDt>
        <ValDt><Dt>${day}</Dt></ValDt>
        <AcctSvcrRef>${ref}</AcctSvcrRef>
        <BkTxCd><Prtry><Cd>NTRF+116+9248+997</Cd><Issr>DK</Issr></Prtry></BkTxCd>
        <NtryDtls>
          <TxDtls>
            <Refs><EndToEndId>${ref}</EndToEndId></Refs>
            <RltdPties>
              <Cdtr><Nm>${counterparty}</Nm></Cdtr>
              <CdtrAcct><Id><IBAN>DE00000000000000009999</IBAN></Id></CdtrAcct>
            </RltdPties>
            <RmtInf><Ustrd>${purpose}</Ustrd></RmtInf>
          </TxDtls>
        </NtryDtls>
        <AddtlNtryInf>Ueberweisung</AddtlNtryInf>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>
`;
	return {
		name: `remote-${iban.slice(-4)}.xml`,
		mimeType: 'application/xml',
		buffer: Buffer.from(xml, 'utf8')
	};
}
