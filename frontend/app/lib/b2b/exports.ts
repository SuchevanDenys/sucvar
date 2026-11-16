// app/lib/b2b/exports.ts
// Pure builders for the B2B CSV and Factur-X (CII / EN 16931) exports.
import { toRon } from '@/app/lib/format';
import { round2, unitCode, xmlEsc, type InvoiceLine } from './estimate';

// Amounts are stored in EUR and exported in RON (same fixed rate as the UI, app/lib/format.ts).

export interface Party {
  name: string;
  vatId: string;
  /** Doar pentru furnizor (firma antreprenorului) — salvate în cloud (`company_profiles`, migrarea 003). */
  regNo?: string;
  address?: string;
  iban?: string;
  bank?: string;
  email?: string;
  phone?: string;
}

/** ISO country from the EU VAT number prefix (ROxx…, FRxx…); Romania by default (a bare CUI has no prefix). */
export function countryOf(vatId: string | undefined): string {
  const m = /^([A-Z]{2})[0-9A-Z]/.exec((vatId ?? '').replace(/\s+/g, '').toUpperCase());
  return m && m[1] !== 'EL' ? m[1] : m?.[1] === 'EL' ? 'GR' : 'RO';
}

export function buildCsv({
  lines,
  net,
  vat,
  vatAmt,
  gross,
}: {
  lines: InvoiceLine[];
  net: number;
  vat: number;
  vatAmt: number;
  gross: number;
}): string {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [
    ['No', 'Description', 'UM', 'Qty', 'Unit price (RON, excl. VAT)', 'Total (RON, excl. VAT)'].map(q).join(';'),
    ...lines.map((l, i) => [i + 1, q(l.name), q(l.unit), l.qty, toRon(l.unitPrice).toFixed(2), toRon(l.total).toFixed(2)].join(';')),
    '',
    [q('Net total'), '', '', '', '', toRon(net).toFixed(2)].join(';'),
    [q(`VAT ${vat}%`), '', '', '', '', toRon(vatAmt).toFixed(2)].join(';'),
    [q('Gross total'), '', '', '', '', toRon(gross).toFixed(2)].join(';'),
  ];
  return rows.join('\r\n');
}

export function buildFacturX({
  lines,
  vat,
  invoiceNo,
  seller,
  buyer,
}: {
  lines: InvoiceLine[];
  vat: number;
  invoiceNo: string;
  seller: Party;
  buyer: Party;
}): string {
  const lineSum = round2(lines.reduce((s, l) => s + toRon(l.total), 0));
  const tax = round2(lineSum * (vat / 100));
  const total = round2(lineSum + tax);
  const issue = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // click handler → client only
  const party = (tag: string, p: { name: string; vatId: string; address?: string }) => `
    <ram:${tag}>
      <ram:Name>${xmlEsc(p.name || 'N/A')}</ram:Name>
      <ram:PostalTradeAddress>${p.address ? `<ram:LineOne>${xmlEsc(p.address)}</ram:LineOne>` : ''}<ram:CountryID>${countryOf(p.vatId)}</ram:CountryID></ram:PostalTradeAddress>${
        p.vatId ? `\n        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">${xmlEsc(p.vatId)}</ram:ID></ram:SpecifiedTaxRegistration>` : ''
      }
    </ram:${tag}>`;
  const lineXml = lines
    .map(
      (l, i) => `
  <ram:IncludedSupplyChainTradeLineItem>
    <ram:AssociatedDocumentLineDocument><ram:LineID>${i + 1}</ram:LineID></ram:AssociatedDocumentLineDocument>
    <ram:SpecifiedTradeProduct><ram:Name>${xmlEsc(l.name)}</ram:Name></ram:SpecifiedTradeProduct>
    <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>${toRon(l.unitPrice).toFixed(2)}</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
    <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="${unitCode(l.unit)}">${l.qty}</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
    <ram:SpecifiedLineTradeSettlement>
      <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>${vat.toFixed(2)}</ram:RateApplicablePercent></ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>${toRon(l.total).toFixed(2)}</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
    </ram:SpecifiedLineTradeSettlement>
  </ram:IncludedSupplyChainTradeLineItem>`,
    )
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
<rsm:ExchangedDocumentContext>
  <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>urn:cen.eu:en16931:2017</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
</rsm:ExchangedDocumentContext>
<rsm:ExchangedDocument>
  <ram:ID>${xmlEsc(invoiceNo || 'DRAFT')}</ram:ID>
  <ram:TypeCode>380</ram:TypeCode>
  <ram:IssueDateTime><udt:DateTimeString format="102">${issue}</udt:DateTimeString></ram:IssueDateTime>
</rsm:ExchangedDocument>
<rsm:SupplyChainTradeTransaction>${lineXml}
  <ram:ApplicableHeaderTradeAgreement>${party('SellerTradeParty', seller)}${party('BuyerTradeParty', buyer)}
  </ram:ApplicableHeaderTradeAgreement>
  <ram:ApplicableHeaderTradeDelivery/>
  <ram:ApplicableHeaderTradeSettlement>
    <ram:InvoiceCurrencyCode>RON</ram:InvoiceCurrencyCode>
    <ram:ApplicableTradeTax>
      <ram:CalculatedAmount>${tax.toFixed(2)}</ram:CalculatedAmount><ram:TypeCode>VAT</ram:TypeCode>
      <ram:BasisAmount>${lineSum.toFixed(2)}</ram:BasisAmount><ram:CategoryCode>S</ram:CategoryCode>
      <ram:RateApplicablePercent>${vat.toFixed(2)}</ram:RateApplicablePercent>
    </ram:ApplicableTradeTax>
    <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
      <ram:LineTotalAmount>${lineSum.toFixed(2)}</ram:LineTotalAmount>
      <ram:TaxBasisTotalAmount>${lineSum.toFixed(2)}</ram:TaxBasisTotalAmount>
      <ram:TaxTotalAmount currencyID="RON">${tax.toFixed(2)}</ram:TaxTotalAmount>
      <ram:GrandTotalAmount>${total.toFixed(2)}</ram:GrandTotalAmount>
      <ram:DuePayableAmount>${total.toFixed(2)}</ram:DuePayableAmount>
    </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
  </ram:ApplicableHeaderTradeSettlement>
</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;
  return xml;
}
