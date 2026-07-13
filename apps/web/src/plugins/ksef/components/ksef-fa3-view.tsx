/**
 * KsefFa3View
 *
 * Document-styled, theme-aware preview of an FA(3) XML invoice mirroring the
 * official KSeF/MF visualization (#1526, originally #1228). Parses the XML
 * client-side using `DOMParser` - no server round-trip required.
 *
 * Displays:
 *   - Header: invoice number (P_2), invoice type subtitle (RodzajFaktury),
 *     KSeF assigned number when present
 *   - Two-column Seller/Buyer blocks with NIP and address
 *   - Details row: issue date (P_1), sale date (P_6), currency (KodWaluty)
 *   - Line-items table with render-derived gross per line; the Unit and
 *     Net unit price columns render only when at least one current line
 *     carries the value (documents issued before the backend emitted
 *     P_8A/P_9A get no dash-only columns)
 *   - VAT summary per band (net / tax / gross) + total due with currency
 *   - Payment section (Platnosc): form label from the 1-7 code map (#1311),
 *     payment term, bank account
 *   - KOR: correction reason + corrected-invoice number; `StanPrzed=1`
 *     "before" rows stay in a separate collapsed section (#1364 follow-up)
 *
 * Skipped by design: Adnotacje (P_16-P_23), WZ, amount-in-words, footer.
 *
 * Returns `null` if the XML cannot be parsed or required fields are missing -
 * the parent (`ksef-invoice-detail-section`) falls through to the placeholder.
 *
 * FA(3) uses XML namespaces; element lookup uses `getElementsByTagName(tagName)`
 * which matches regardless of namespace prefix (the local name is sufficient).
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import type { FaData, FaLine, FaParty, FaPayment, FaVatBand } from './ksef-fa3-view.types';

interface KsefFa3ViewProps {
  xmlText: string;
}

/**
 * FA(3) VAT-band net/tax element pairs in XSD emit order, mirroring the
 * `VAT_BANDS` map in the backend builder (`fa3-xml.builder.ts`). Net-only
 * bands carry no `tax` element.
 */
const VAT_BAND_ELEMENTS: ReadonlyArray<{ net: string; tax: string | null; label: string }> = [
  { net: 'P_13_1', tax: 'P_14_1', label: '23%' },
  { net: 'P_13_2', tax: 'P_14_2', label: '8%' },
  { net: 'P_13_3', tax: 'P_14_3', label: '5%' },
  { net: 'P_13_6_1', tax: null, label: '0%' },
  { net: 'P_13_6_2', tax: null, label: '0% WDT' },
  { net: 'P_13_6_3', tax: null, label: '0% EX' },
  { net: 'P_13_7', tax: null, label: 'zw' },
  { net: 'P_13_8', tax: null, label: 'np I' },
  { net: 'P_13_9', tax: null, label: 'np II' },
  { net: 'P_13_10', tax: null, label: 'oo' },
];

/**
 * `FormaPlatnosci` code (`TFormaPlatnosci`, 1-7) to i18n key + English
 * fallback. Mirrors `KSEF_FORMA_PLATNOSCI_VALUES` / `FORMA_PLATNOSCI_LABELS`
 * from the connection setup form (#1311).
 */
const PAYMENT_FORM_LABELS: Readonly<Record<string, { key: string; fallback: string }>> = {
  '1': { key: 'invoice.ksef.fa3PaymentFormCash', fallback: 'Cash' },
  '2': { key: 'invoice.ksef.fa3PaymentFormCard', fallback: 'Card' },
  '3': { key: 'invoice.ksef.fa3PaymentFormVoucher', fallback: 'Voucher' },
  '4': { key: 'invoice.ksef.fa3PaymentFormCheque', fallback: 'Cheque' },
  '5': { key: 'invoice.ksef.fa3PaymentFormCredit', fallback: 'Credit' },
  '6': { key: 'invoice.ksef.fa3PaymentFormTransfer', fallback: 'Transfer' },
  '7': { key: 'invoice.ksef.fa3PaymentFormMobile', fallback: 'Mobile' },
};

/** Extract text content from the first matching element (namespace-agnostic). */
function getText(root: Element | Document, tagName: string): string | null {
  // getElementsByTagName matches regardless of namespace prefix, making it safe
  // for FA(3) XML which uses `tns:` or other namespace prefixes.
  const el = root.getElementsByTagName(tagName).item(0);
  return el?.textContent?.trim() ?? null;
}

/** Parse a `Podmiot1`/`Podmiot2` element into name + NIP + address. */
function parseParty(podmiot: Element | null): FaParty {
  const idEl = podmiot?.getElementsByTagName('DaneIdentyfikacyjne').item(0) ?? null;
  const adresEl = podmiot?.getElementsByTagName('Adres').item(0) ?? null;
  const addressLines: string[] = [];
  if (adresEl) {
    const l1 = getText(adresEl, 'AdresL1');
    const l2 = getText(adresEl, 'AdresL2');
    if (l1 !== null) addressLines.push(l1);
    if (l2 !== null) addressLines.push(l2);
  }
  return {
    // The builder emits `Nazwa` (FA(3) `DaneIdentyfikacyjne`); `NazwaSkrocona`
    // is the fallback for foreign-issued documents.
    name: idEl ? (getText(idEl, 'Nazwa') ?? getText(idEl, 'NazwaSkrocona')) : null,
    nip: idEl ? getText(idEl, 'NIP') : null,
    addressLines,
    countryCode: adresEl ? getText(adresEl, 'KodKraju') : null,
  };
}

/** Parse the optional `Platnosc` block. Returns null when absent/empty. */
function parsePayment(fa: Element): FaPayment | null {
  const platnosc = fa.getElementsByTagName('Platnosc').item(0);
  if (!platnosc) return null;
  const terminEl = platnosc.getElementsByTagName('TerminPlatnosci').item(0);
  const termDate = terminEl ? getText(terminEl, 'Termin') : null;
  let termDescription: string | null = null;
  const opisEl = terminEl?.getElementsByTagName('TerminOpis').item(0) ?? null;
  if (opisEl) {
    const count = getText(opisEl, 'Ilosc');
    const unit = getText(opisEl, 'Jednostka');
    termDescription = [count, unit].filter((part) => part !== null).join(' ') || null;
  }
  const bankEl = platnosc.getElementsByTagName('RachunekBankowy').item(0);
  const payment: FaPayment = {
    termDate,
    termDescription,
    formCode: getText(platnosc, 'FormaPlatnosci'),
    bankAccount: bankEl ? getText(bankEl, 'NrRB') : null,
  };
  const hasContent =
    payment.termDate !== null ||
    payment.termDescription !== null ||
    payment.formCode !== null ||
    payment.bankAccount !== null;
  return hasContent ? payment : null;
}

function parseFa3Xml(xmlText: string): FaData | null {
  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, 'application/xml');
    // DOMParser signals parse errors via a <parsererror> element rather than throwing.
    if (doc.getElementsByTagName('parsererror').length > 0) {
      return null;
    }
  } catch {
    return null;
  }

  // Locate the root <Faktura> element (tag may be namespace-prefixed in real docs).
  const faktura = doc.getElementsByTagName('Faktura').item(0);
  if (!faktura) return null;

  const fa = faktura.getElementsByTagName('Fa').item(0);
  if (!fa) return null;

  // FA(3): P_1 = issue date, P_2 = invoice number (previously swapped, #1526).
  const invoiceNumber = getText(fa, 'P_2');
  // Require at minimum the invoice number to consider the parse successful.
  if (invoiceNumber === null) return null;

  const lineEls = Array.from(fa.getElementsByTagName('FaWiersz'));
  const lines: FaLine[] = lineEls.map((el) => ({
    lineNo: getText(el, 'NrWierszaFa'),
    description: getText(el, 'P_7'),
    unit: getText(el, 'P_8A'),
    quantity: getText(el, 'P_8B'),
    netUnitPrice: getText(el, 'P_9A'),
    netTotal: getText(el, 'P_11'),
    vatRate: getText(el, 'P_12'),
    isBeforeCorrection: getText(el, 'StanPrzed') === '1',
  }));

  const vatBands: FaVatBand[] = [];
  for (const band of VAT_BAND_ELEMENTS) {
    const net = getText(fa, band.net);
    if (net === null) continue;
    vatBands.push({
      label: band.label,
      net,
      tax: band.tax !== null ? getText(fa, band.tax) : null,
    });
  }

  const korygowanaEl = fa.getElementsByTagName('DaneFaKorygowanej').item(0);
  const ksef = faktura.getElementsByTagName('KSeF').item(0);

  return {
    invoiceNumber,
    issueDate: getText(fa, 'P_1'),
    saleDate: getText(fa, 'P_6'),
    currency: getText(fa, 'KodWaluty'),
    invoiceType: getText(fa, 'RodzajFaktury'),
    seller: parseParty(faktura.getElementsByTagName('Podmiot1').item(0)),
    buyer: parseParty(faktura.getElementsByTagName('Podmiot2').item(0)),
    lines,
    vatBands,
    grandTotal: getText(fa, 'P_15'),
    ksefNumber: ksef ? getText(ksef, 'NrKSeF') : null,
    correctionReason: getText(fa, 'PrzyczynaKorekty'),
    correctedInvoiceNumber: korygowanaEl ? getText(korygowanaEl, 'NrFaKorygowanej') : null,
    payment: parsePayment(fa),
  };
}

/**
 * Derive a gross amount from a decimal string and a `P_12` VAT band. Numeric
 * bands (23/8/5/0) apply `net * (1 + rate)`; non-numeric bands (zw, np, oo)
 * carry no VAT, so gross = net. Returns null when the net is not numeric.
 */
function deriveGross(net: string | null, vatRate: string | null): string | null {
  if (net === null) return null;
  const netValue = Number(net);
  if (!Number.isFinite(netValue)) return null;
  const rate = vatRate !== null && /^\d+([.,]\d+)?$/.test(vatRate) ? Number(vatRate.replace(',', '.')) : 0;
  return (netValue * (1 + rate / 100)).toFixed(2);
}

/** Gross for a VAT summary band: net + tax (net-only bands carry no tax). */
function bandGross(band: FaVatBand): string | null {
  const netValue = Number(band.net);
  if (!Number.isFinite(netValue)) return null;
  const taxValue = band.tax !== null ? Number(band.tax) : 0;
  if (!Number.isFinite(taxValue)) return null;
  return (netValue + taxValue).toFixed(2);
}

/** Format a `P_12` band for display: numeric bands get a `%` suffix. */
function formatVatRate(vatRate: string | null): string {
  if (vatRate === null) return '-';
  return /^\d+([.,]\d+)?$/.test(vatRate) ? `${vatRate}%` : vatRate;
}

interface LinesTableProps {
  lines: FaLine[];
  showUnit: boolean;
  showNetUnitPrice: boolean;
}

function LinesTable({ lines, showUnit, showNetUnitPrice }: LinesTableProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="ksef-fa3-view__table-wrap">
      <table className="ksef-fa3-view__table">
        <thead>
          <tr>
            <th>{t('invoice.ksef.fa3LineNo', '#')}</th>
            <th className="ksef-fa3-view__col-desc">
              {t('invoice.ksef.fa3LineDesc', 'Description')}
            </th>
            {showNetUnitPrice ? (
              <th className="ksef-fa3-view__col-num">
                {t('invoice.ksef.fa3LineNetPrice', 'Net unit price')}
              </th>
            ) : null}
            <th className="ksef-fa3-view__col-num">{t('invoice.ksef.fa3LineQty', 'Qty')}</th>
            {showUnit ? <th>{t('invoice.ksef.fa3LineUnit', 'Unit')}</th> : null}
            <th className="ksef-fa3-view__col-num">{t('invoice.ksef.fa3LineVat', 'VAT rate')}</th>
            <th className="ksef-fa3-view__col-num">
              {t('invoice.ksef.fa3LineNetTotal', 'Net total')}
            </th>
            <th className="ksef-fa3-view__col-num">
              {t('invoice.ksef.fa3LineGrossTotal', 'Gross total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, idx) => (
            <tr key={line.lineNo ?? idx}>
              <td>{line.lineNo ?? String(idx + 1)}</td>
              <td className="ksef-fa3-view__col-desc">{line.description ?? '-'}</td>
              {showNetUnitPrice ? (
                <td className="ksef-fa3-view__col-num tabular">{line.netUnitPrice ?? '-'}</td>
              ) : null}
              <td className="ksef-fa3-view__col-num tabular">{line.quantity ?? '-'}</td>
              {showUnit ? <td>{line.unit ?? '-'}</td> : null}
              <td className="ksef-fa3-view__col-num tabular">{formatVatRate(line.vatRate)}</td>
              <td className="ksef-fa3-view__col-num tabular">{line.netTotal ?? '-'}</td>
              <td className="ksef-fa3-view__col-num tabular">
                {deriveGross(line.netTotal, line.vatRate) ?? '-'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PartyBlockProps {
  label: string;
  party: FaParty;
}

function PartyBlock({ label, party }: PartyBlockProps): ReactElement {
  const { t } = useTranslation();
  return (
    <div className="ksef-fa3-view__party">
      <div className="ksef-fa3-view__party-label">{label}</div>
      <div className="ksef-fa3-view__party-name">{party.name ?? '-'}</div>
      {party.nip !== null ? (
        <div className="ksef-fa3-view__party-line">
          {t('invoice.ksef.fa3Nip', 'NIP')}: <span className="mono-text">{party.nip}</span>
        </div>
      ) : null}
      {party.addressLines.map((line) => (
        <div key={line} className="ksef-fa3-view__party-line">
          {line}
        </div>
      ))}
      {party.countryCode !== null ? (
        <div className="ksef-fa3-view__party-line">{party.countryCode}</div>
      ) : null}
    </div>
  );
}

export function KsefFa3View({ xmlText }: KsefFa3ViewProps): ReactElement | null {
  const { t } = useTranslation();
  const data = parseFa3Xml(xmlText);
  if (!data) return null;

  const isCorrection = data.invoiceType === 'KOR';
  const subtitle = isCorrection
    ? t('invoice.ksef.fa3TypeCorrection', 'Correction invoice')
    : t('invoice.ksef.fa3TypeStandard', 'Standard invoice');

  // A KOR correction emits one "before" row (StanPrzed=1) per changed line
  // plus every current "after" line. The VAT summary / grand total below
  // already reflect only the corrected delta/state, so the main table must
  // too - otherwise line counts and totals double up (#1364 follow-up). The
  // "before" rows are still shown, but in a separate, clearly labeled set.
  const currentLines = data.lines.filter((line) => !line.isBeforeCorrection);
  const beforeCorrectionLines = data.lines.filter((line) => line.isBeforeCorrection);

  // Documents issued before the backend emitted P_8A/P_9A must not render
  // dash-only columns - show them only when a current line carries the value.
  const showUnit = currentLines.some((line) => line.unit !== null);
  const showNetUnitPrice = currentLines.some((line) => line.netUnitPrice !== null);

  const paymentFormLabel =
    data.payment?.formCode !== null && data.payment?.formCode !== undefined
      ? PAYMENT_FORM_LABELS[data.payment.formCode]
      : undefined;

  return (
    <div className="ksef-fa3-view">
      {/* Document header */}
      <header className="ksef-fa3-view__header">
        <div>
          <div className="ksef-fa3-view__doc-number mono-text">{data.invoiceNumber}</div>
          <div className="ksef-fa3-view__doc-type">{subtitle}</div>
        </div>
        {data.ksefNumber !== null ? (
          <div className="ksef-fa3-view__ksef-number">
            <div className="ksef-fa3-view__field-label">
              {t('invoice.ksef.fa3KsefNumber', 'KSeF number')}
            </div>
            <div className="mono-text text-sm">{data.ksefNumber}</div>
          </div>
        ) : null}
      </header>

      {/* Seller / Buyer */}
      <section className="ksef-fa3-view__parties">
        <PartyBlock label={t('invoice.ksef.fa3Seller', 'Seller')} party={data.seller} />
        <PartyBlock label={t('invoice.ksef.fa3Buyer', 'Buyer')} party={data.buyer} />
      </section>

      {/* Details row */}
      <section className="ksef-fa3-view__details">
        {data.issueDate !== null ? (
          <div>
            <div className="ksef-fa3-view__field-label">
              {t('invoice.ksef.fa3IssueDate', 'Issue date')}
            </div>
            <div className="tabular">{data.issueDate}</div>
          </div>
        ) : null}
        {data.saleDate !== null ? (
          <div>
            <div className="ksef-fa3-view__field-label">
              {t('invoice.ksef.fa3SaleDate', 'Sale date')}
            </div>
            <div className="tabular">{data.saleDate}</div>
          </div>
        ) : null}
        {data.currency !== null ? (
          <div>
            <div className="ksef-fa3-view__field-label">
              {t('invoice.ksef.fa3Currency', 'Currency')}
            </div>
            <div>{data.currency}</div>
          </div>
        ) : null}
      </section>

      {/* KOR correction metadata */}
      {data.correctionReason !== null || data.correctedInvoiceNumber !== null ? (
        <section className="ksef-fa3-view__correction">
          {data.correctedInvoiceNumber !== null ? (
            <div>
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3CorrectedInvoice', 'Corrects invoice')}
              </span>{' '}
              <span className="mono-text">{data.correctedInvoiceNumber}</span>
            </div>
          ) : null}
          {data.correctionReason !== null ? (
            <div>
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3CorrectionReason', 'Correction reason')}
              </span>{' '}
              {data.correctionReason}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Line items (current / "after" state) */}
      {currentLines.length > 0 ? (
        <section className="ksef-fa3-view__lines">
          <div className="ksef-fa3-view__section-title">
            {t('invoice.ksef.fa3Lines', 'Invoice lines')}
          </div>
          <LinesTable
            lines={currentLines}
            showUnit={showUnit}
            showNetUnitPrice={showNetUnitPrice}
          />
        </section>
      ) : null}

      {/* KOR "before correction" lines - shown separately so they never mix
          into the current-state table/totals above. */}
      {beforeCorrectionLines.length > 0 ? (
        <details className="ksef-fa3-view__before-correction">
          <summary className="ksef-fa3-view__section-title">
            {t('invoice.ksef.fa3LinesBefore', 'Lines before correction')}
          </summary>
          <LinesTable
            lines={beforeCorrectionLines}
            showUnit={showUnit}
            showNetUnitPrice={showNetUnitPrice}
          />
        </details>
      ) : null}

      {/* VAT summary */}
      {data.vatBands.length > 0 ? (
        <section className="ksef-fa3-view__vat">
          <div className="ksef-fa3-view__section-title">
            {t('invoice.ksef.fa3VatSummary', 'VAT summary')}
          </div>
          <div className="ksef-fa3-view__table-wrap">
            <table className="ksef-fa3-view__table">
              <thead>
                <tr>
                  <th>{t('invoice.ksef.fa3VatRate', 'Rate')}</th>
                  <th className="ksef-fa3-view__col-num">{t('invoice.ksef.fa3VatNet', 'Net')}</th>
                  <th className="ksef-fa3-view__col-num">{t('invoice.ksef.fa3VatTax', 'Tax')}</th>
                  <th className="ksef-fa3-view__col-num">
                    {t('invoice.ksef.fa3VatGross', 'Gross')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.vatBands.map((band) => (
                  <tr key={band.label}>
                    <td>{band.label}</td>
                    <td className="ksef-fa3-view__col-num tabular">{band.net}</td>
                    <td className="ksef-fa3-view__col-num tabular">{band.tax ?? '-'}</td>
                    <td className="ksef-fa3-view__col-num tabular">{bandGross(band) ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Total due */}
      {data.grandTotal !== null ? (
        <div className="ksef-fa3-view__total">
          <span className="ksef-fa3-view__field-label">
            {t('invoice.ksef.fa3GrandTotal', 'Total due')}
          </span>
          <span className="ksef-fa3-view__total-value tabular">
            {data.grandTotal}
            {data.currency !== null ? ` ${data.currency}` : ''}
          </span>
        </div>
      ) : null}

      {/* Payment */}
      {data.payment !== null ? (
        <section className="ksef-fa3-view__payment">
          <div className="ksef-fa3-view__section-title">
            {t('invoice.ksef.fa3Payment', 'Payment')}
          </div>
          {paymentFormLabel !== undefined ? (
            <div className="ksef-fa3-view__payment-row">
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3PaymentForm', 'Payment form')}
              </span>{' '}
              {t(paymentFormLabel.key, paymentFormLabel.fallback)}
            </div>
          ) : null}
          {data.payment.termDate !== null || data.payment.termDescription !== null ? (
            <div className="ksef-fa3-view__payment-row">
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3PaymentTerm', 'Payment term')}
              </span>{' '}
              <span className="tabular">
                {data.payment.termDate ?? data.payment.termDescription}
              </span>
            </div>
          ) : null}
          {data.payment.bankAccount !== null ? (
            <div className="ksef-fa3-view__payment-row">
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3PaymentAccount', 'Bank account')}
              </span>{' '}
              <span className="mono-text">{data.payment.bankAccount}</span>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
