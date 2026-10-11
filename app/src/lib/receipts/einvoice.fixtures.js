// Made-up e-invoices for tests (#160): no real vendor, buyer, IBAN or
// amount. Minimal, but shaped as XRechnung 3.0 and Factur-X write them.

/* eslint-disable belege/no-german -- made-up invoice texts, as German vendors write them */

export const UBL_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
	xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
	xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
	<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
	<cbc:ID>WB-2026-0815</cbc:ID>
	<cbc:IssueDate>2026-09-14</cbc:IssueDate>
	<cbc:DueDate>2026-09-28</cbc:DueDate>
	<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
	<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
	<cac:InvoicePeriod><cbc:StartDate>2026-09-01</cbc:StartDate><cbc:EndDate>2026-09-30</cbc:EndDate></cac:InvoicePeriod>
	<cac:AccountingSupplierParty><cac:Party>
		<cac:PartyName><cbc:Name>Wolkenbau</cbc:Name></cac:PartyName>
		<cac:PartyTaxScheme><cbc:CompanyID>DE000000000</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
		<cac:PartyLegalEntity><cbc:RegistrationName>Wolkenbau Beispiel GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
	</cac:Party></cac:AccountingSupplierParty>
	<cac:AccountingCustomerParty><cac:Party>
		<cac:PartyIdentification><cbc:ID>K-4711</cbc:ID></cac:PartyIdentification>
		<cac:PartyLegalEntity><cbc:RegistrationName>Kundin Beispiel UG</cbc:RegistrationName></cac:PartyLegalEntity>
	</cac:Party></cac:AccountingCustomerParty>
	<cac:PaymentMeans>
		<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
		<cac:PayeeFinancialAccount><cbc:ID>DE00 1234 5678 9000 0012 34</cbc:ID></cac:PayeeFinancialAccount>
	</cac:PaymentMeans>
	<cac:TaxTotal>
		<cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>
		<cac:TaxSubtotal>
			<cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount>
			<cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount>
			<cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>
		</cac:TaxSubtotal>
	</cac:TaxTotal>
	<cac:LegalMonetaryTotal>
		<cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
		<cbc:TaxExclusiveAmount currencyID="EUR">100.00</cbc:TaxExclusiveAmount>
		<cbc:TaxInclusiveAmount currencyID="EUR">119.00</cbc:TaxInclusiveAmount>
		<cbc:PayableAmount currencyID="EUR">119.00</cbc:PayableAmount>
	</cac:LegalMonetaryTotal>
	<cac:InvoiceLine>
		<cbc:ID>1</cbc:ID>
		<cbc:InvoicedQuantity unitCode="MON">1</cbc:InvoicedQuantity>
		<cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount>
		<cac:Item><cbc:Name>Speicherpaket Beispiel September</cbc:Name></cac:Item>
		<cac:Price><cbc:PriceAmount currencyID="EUR">100.00</cbc:PriceAmount></cac:Price>
	</cac:InvoiceLine>
</ubl:Invoice>
`;

export const UBL_CREDIT_NOTE = `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
	xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
	xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
	<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
	<cbc:ID>WB-G-2026-07</cbc:ID>
	<cbc:IssueDate>2026-09-20</cbc:IssueDate>
	<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>
	<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
	<cac:AccountingSupplierParty><cac:Party>
		<cac:PartyLegalEntity><cbc:RegistrationName>Wolkenbau Beispiel GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
	</cac:Party></cac:AccountingSupplierParty>
	<cac:TaxTotal>
		<cac:TaxSubtotal>
			<cbc:TaxableAmount currencyID="EUR">10.00</cbc:TaxableAmount>
			<cbc:TaxAmount currencyID="EUR">1.90</cbc:TaxAmount>
			<cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:TaxCategory>
		</cac:TaxSubtotal>
	</cac:TaxTotal>
	<cac:LegalMonetaryTotal>
		<cbc:TaxExclusiveAmount currencyID="EUR">10.00</cbc:TaxExclusiveAmount>
		<cbc:TaxInclusiveAmount currencyID="EUR">11.90</cbc:TaxInclusiveAmount>
		<cbc:PayableAmount currencyID="EUR">11.90</cbc:PayableAmount>
	</cac:LegalMonetaryTotal>
	<cac:CreditNoteLine>
		<cbc:LineExtensionAmount currencyID="EUR">10.00</cbc:LineExtensionAmount>
		<cac:Item><cbc:Name>Gutschrift Ausfall Beispiel</cbc:Name></cac:Item>
	</cac:CreditNoteLine>
</CreditNote>
`;

/** @param {string} guideline the profile (EN 16931, XRechnung, BASIC WL …) */
export const ciiInvoice = (guideline) => `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
	xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
	xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
	<rsm:ExchangedDocumentContext>
		<ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${guideline}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
	</rsm:ExchangedDocumentContext>
	<rsm:ExchangedDocument>
		<ram:ID>PW-2026-0042</ram:ID>
		<ram:TypeCode>380</ram:TypeCode>
		<ram:IssueDateTime><udt:DateTimeString format="102">20260914</udt:DateTimeString></ram:IssueDateTime>
	</rsm:ExchangedDocument>
	<rsm:SupplyChainTradeTransaction>
		<ram:IncludedSupplyChainTradeLineItem>
			<ram:SpecifiedTradeProduct><ram:Name>Druckpapier Beispiel A4</ram:Name></ram:SpecifiedTradeProduct>
			<ram:SpecifiedLineTradeSettlement><ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>41.09</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation></ram:SpecifiedLineTradeSettlement>
		</ram:IncludedSupplyChainTradeLineItem>
		<ram:ApplicableHeaderTradeAgreement>
			<ram:SellerTradeParty>
				<ram:Name>Papierwerk Beispiel GmbH</ram:Name>
				<ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE000000001</ram:ID></ram:SpecifiedTaxRegistration>
			</ram:SellerTradeParty>
			<ram:BuyerTradeParty><ram:ID>K-0042</ram:ID><ram:Name>Kundin Beispiel UG</ram:Name></ram:BuyerTradeParty>
		</ram:ApplicableHeaderTradeAgreement>
		<ram:ApplicableHeaderTradeSettlement>
			<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
			<ram:SpecifiedTradeSettlementPaymentMeans>
				<ram:TypeCode>59</ram:TypeCode>
				<ram:PayeePartyCreditorFinancialAccount><ram:IBANID>DE00123456789000009876</ram:IBANID></ram:PayeePartyCreditorFinancialAccount>
			</ram:SpecifiedTradeSettlementPaymentMeans>
			<ram:ApplicableTradeTax>
				<ram:CalculatedAmount>7.81</ram:CalculatedAmount>
				<ram:TypeCode>VAT</ram:TypeCode>
				<ram:BasisAmount>41.09</ram:BasisAmount>
				<ram:CategoryCode>S</ram:CategoryCode>
				<ram:RateApplicablePercent>19</ram:RateApplicablePercent>
			</ram:ApplicableTradeTax>
			<ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20260930</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
			<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
				<ram:LineTotalAmount>41.09</ram:LineTotalAmount>
				<ram:TaxBasisTotalAmount>41.09</ram:TaxBasisTotalAmount>
				<ram:TaxTotalAmount currencyID="EUR">7.81</ram:TaxTotalAmount>
				<ram:GrandTotalAmount>48.90</ram:GrandTotalAmount>
				<ram:DuePayableAmount>48.90</ram:DuePayableAmount>
			</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
		</ram:ApplicableHeaderTradeSettlement>
	</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;

export const CII_XRECHNUNG = ciiInvoice(
	'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0'
);
export const CII_BASIC_WL = ciiInvoice('urn:factur-x.eu:1p0:basicwl');
