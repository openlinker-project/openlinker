/**
 * KsefFa3View
 *
 * Renders a structured human-readable view of an FA(3) XML document (#1228).
 * Parses the XML client-side using `DOMParser` — no server round-trip required.
 *
 * Displays:
 *   - Seller identity (name + NIP)
 *   - Buyer identity (name + NIP)
 *   - Invoice number and issue date
 *   - Invoice lines table (line#, description, unit, qty, net price, net total, VAT rate) —
 *     current ("after") lines only; a KOR correction's `StanPrzed=1` "before" rows render in
 *     a separate collapsed section so they never mix into the main table/totals (#1364 follow-up)
 *   - VAT band summary (23%, 8%, 5%, 0%)
 *   - Grand total
 *   - KSeF assigned number (if present)
 *
 * Returns `null` if the XML cannot be parsed or required fields are missing —
 * the parent (`ksef-invoice-detail-section`) falls through to the placeholder.
 *
 * FA(3) uses XML namespaces; element lookup uses `getElementsByTagName(tagName)`
 * which matches regardless of namespace prefix (the local name is sufficient for FA(3)).
 *
 * @module plugins/ksef/components
 */
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import type { FaData, FaLine } from './ksef-fa3-view.types';

interface KsefFa3ViewProps {
  xmlText: string;
}

/** Extract text content from the first matching element (namespace-agnostic). */
function getText(root: Element | Document, tagName: string): string | null {
  // getElementsByTagName matches regardless of namespace prefix, making it safe
  // for FA(3) XML which uses `tns:` or other namespace prefixes.
  const el = root.getElementsByTagName(tagName).item(0);
  return el?.textContent?.trim() ?? null;
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

  const podmiot1 = faktura.getElementsByTagName('Podmiot1').item(0);
  const podmiot2 = faktura.getElementsByTagName('Podmiot2').item(0);
  const fa = faktura.getElementsByTagName('Fa').item(0);
  const ksef = faktura.getElementsByTagName('KSeF').item(0);

  const sellerIdEl = podmiot1?.getElementsByTagName('DaneIdentyfikacyjne').item(0) ?? null;
  const buyerIdEl = podmiot2?.getElementsByTagName('DaneIdentyfikacyjne').item(0) ?? null;

  const sellerName = sellerIdEl
    ? getText(sellerIdEl, 'NazwaSkrocona')
    : null;
  const sellerNip = sellerIdEl ? getText(sellerIdEl, 'NIP') : null;
  const buyerName = buyerIdEl
    ? getText(buyerIdEl, 'NazwaSkrocona')
    : null;
  const buyerNip = buyerIdEl ? getText(buyerIdEl, 'NIP') : null;

  const invoiceNumber = fa ? getText(fa, 'P_1') : null;
  const issueDate = fa ? getText(fa, 'P_2') : null;

  const lineEls = fa ? Array.from(fa.getElementsByTagName('FaWiersz')) : [];
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

  const vatNet23 = fa ? getText(fa, 'P_13_1') : null;
  const vatTax23 = fa ? getText(fa, 'P_14_1') : null;
  const vatNet8 = fa ? getText(fa, 'P_13_2') : null;
  const vatTax8 = fa ? getText(fa, 'P_14_2') : null;
  const vatNet5 = fa ? getText(fa, 'P_13_3') : null;
  const vatTax5 = fa ? getText(fa, 'P_14_3') : null;
  const vatNet0 = fa ? getText(fa, 'P_13_5') : null;
  const vatTax0 = fa ? getText(fa, 'P_14_5') : null;
  const grandTotal = fa ? getText(fa, 'P_15') : null;
  const ksefNumber = ksef ? getText(ksef, 'NrKSeF') : null;

  // Require at minimum the invoice number to consider the parse successful.
  if (!invoiceNumber) return null;

  return {
    sellerName,
    sellerNip,
    buyerName,
    buyerNip,
    invoiceNumber,
    issueDate,
    lines,
    vatNet23,
    vatTax23,
    vatNet8,
    vatTax8,
    vatNet5,
    vatTax5,
    vatNet0,
    vatTax0,
    grandTotal,
    ksefNumber,
  };
}

export function KsefFa3View({ xmlText }: KsefFa3ViewProps): ReactElement | null {
  const { t } = useTranslation();
  const data = parseFa3Xml(xmlText);
  if (!data) return null;

  const hasVatBands =
    data.vatNet23 !== null ||
    data.vatNet8 !== null ||
    data.vatNet5 !== null ||
    data.vatNet0 !== null;

  // A KOR correction emits one "before" row (StanPrzed=1) per changed line
  // plus every current "after" line. The VAT summary / grand total below
  // already reflect only the "after" state, so the main table must too —
  // otherwise line counts and totals double up (#1364 follow-up). The
  // "before" rows are still shown, but in a separate, clearly labeled set.
  const currentLines = data.lines.filter((line) => !line.isBeforeCorrection);
  const beforeCorrectionLines = data.lines.filter((line) => line.isBeforeCorrection);

  return (
    <div className="ksef-fa3-view">
      {/* Invoice header */}
      <div className="slot-row">
        <div>
          <div className="slot-row__label">
            {t('invoice.ksef.fa3InvoiceNumber', 'Invoice number')}
          </div>
        </div>
        <span className="mono-text text-sm">{data.invoiceNumber}</span>
      </div>

      {data.issueDate !== null ? (
        <div className="slot-row">
          <div>
            <div className="slot-row__label">
              {t('invoice.ksef.fa3IssueDate', 'Issue date')}
            </div>
          </div>
          <span>{data.issueDate}</span>
        </div>
      ) : null}

      {/* Seller */}
      {data.sellerName !== null || data.sellerNip !== null ? (
        <div className="slot-row">
          <div>
            <div className="slot-row__label">
              {t('invoice.ksef.fa3Seller', 'Seller')}
            </div>
            {data.sellerNip !== null ? (
              <div className="slot-row__hint">
                {t('invoice.ksef.fa3Nip', 'NIP')}: {data.sellerNip}
              </div>
            ) : null}
          </div>
          <span>{data.sellerName ?? '—'}</span>
        </div>
      ) : null}

      {/* Buyer */}
      {data.buyerName !== null || data.buyerNip !== null ? (
        <div className="slot-row">
          <div>
            <div className="slot-row__label">
              {t('invoice.ksef.fa3Buyer', 'Buyer')}
            </div>
            {data.buyerNip !== null ? (
              <div className="slot-row__hint">
                {t('invoice.ksef.fa3Nip', 'NIP')}: {data.buyerNip}
              </div>
            ) : null}
          </div>
          <span>{data.buyerName ?? '—'}</span>
        </div>
      ) : null}

      {/* Line items (current / "after" state) */}
      {currentLines.length > 0 ? (
        <div className="ksef-fa3-view__lines">
          <div className="slot-row__label ksef-fa3-view__lines-title">
            {t('invoice.ksef.fa3Lines', 'Invoice lines')}
          </div>
          <div className="ksef-fa3-view__lines-table-wrap">
            <table className="ksef-fa3-view__lineitems">
              <thead>
                <tr>
                  <th>{t('invoice.ksef.fa3LineNo', '#')}</th>
                  <th>{t('invoice.ksef.fa3LineDesc', 'Description')}</th>
                  <th>{t('invoice.ksef.fa3LineUnit', 'Unit')}</th>
                  <th>{t('invoice.ksef.fa3LineQty', 'Qty')}</th>
                  <th>{t('invoice.ksef.fa3LineNetPrice', 'Net price')}</th>
                  <th>{t('invoice.ksef.fa3LineNetTotal', 'Net total')}</th>
                  <th>{t('invoice.ksef.fa3LineVat', 'VAT')}</th>
                </tr>
              </thead>
              <tbody>
                {currentLines.map((line, idx) => (
                  <tr key={line.lineNo ?? idx}>
                    <td>{line.lineNo ?? String(idx + 1)}</td>
                    <td>{line.description ?? '—'}</td>
                    <td>{line.unit ?? '—'}</td>
                    <td>{line.quantity ?? '—'}</td>
                    <td>{line.netUnitPrice ?? '—'}</td>
                    <td>{line.netTotal ?? '—'}</td>
                    <td>{line.vatRate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* KOR "before correction" lines — shown separately so they never mix
          into the current-state table/totals above. */}
      {beforeCorrectionLines.length > 0 ? (
        <details className="ksef-fa3-view__before-correction">
          <summary className="slot-row__label ksef-fa3-view__lines-title">
            {t('invoice.ksef.fa3LinesBefore', 'Lines before correction')}
          </summary>
          <div className="ksef-fa3-view__lines-table-wrap">
            <table className="ksef-fa3-view__lineitems">
              <thead>
                <tr>
                  <th>{t('invoice.ksef.fa3LineNo', '#')}</th>
                  <th>{t('invoice.ksef.fa3LineDesc', 'Description')}</th>
                  <th>{t('invoice.ksef.fa3LineUnit', 'Unit')}</th>
                  <th>{t('invoice.ksef.fa3LineQty', 'Qty')}</th>
                  <th>{t('invoice.ksef.fa3LineNetPrice', 'Net price')}</th>
                  <th>{t('invoice.ksef.fa3LineNetTotal', 'Net total')}</th>
                  <th>{t('invoice.ksef.fa3LineVat', 'VAT')}</th>
                </tr>
              </thead>
              <tbody>
                {beforeCorrectionLines.map((line, idx) => (
                  <tr key={line.lineNo ?? idx}>
                    <td>{line.lineNo ?? String(idx + 1)}</td>
                    <td>{line.description ?? '—'}</td>
                    <td>{line.unit ?? '—'}</td>
                    <td>{line.quantity ?? '—'}</td>
                    <td>{line.netUnitPrice ?? '—'}</td>
                    <td>{line.netTotal ?? '—'}</td>
                    <td>{line.vatRate ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {/* VAT bands */}
      {hasVatBands ? (
        <div className="ksef-fa3-view__vat">
          <div className="slot-row__label ksef-fa3-view__vat-title">
            {t('invoice.ksef.fa3VatSummary', 'VAT summary')}
          </div>
          {data.vatNet23 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">23% {t('invoice.ksef.fa3VatNet', 'Net')}</div>
              <span>{data.vatNet23}</span>
            </div>
          ) : null}
          {data.vatTax23 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">23% {t('invoice.ksef.fa3VatTax', 'Tax')}</div>
              <span>{data.vatTax23}</span>
            </div>
          ) : null}
          {data.vatNet8 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">8% {t('invoice.ksef.fa3VatNet', 'Net')}</div>
              <span>{data.vatNet8}</span>
            </div>
          ) : null}
          {data.vatTax8 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">8% {t('invoice.ksef.fa3VatTax', 'Tax')}</div>
              <span>{data.vatTax8}</span>
            </div>
          ) : null}
          {data.vatNet5 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">5% {t('invoice.ksef.fa3VatNet', 'Net')}</div>
              <span>{data.vatNet5}</span>
            </div>
          ) : null}
          {data.vatTax5 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">5% {t('invoice.ksef.fa3VatTax', 'Tax')}</div>
              <span>{data.vatTax5}</span>
            </div>
          ) : null}
          {data.vatNet0 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">0% {t('invoice.ksef.fa3VatNet', 'Net')}</div>
              <span>{data.vatNet0}</span>
            </div>
          ) : null}
          {data.vatTax0 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">0% {t('invoice.ksef.fa3VatTax', 'Tax')}</div>
              <span>{data.vatTax0}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Grand total */}
      {data.grandTotal !== null ? (
        <div className="slot-row ksef-fa3-view__total">
          <div className="slot-row__label">
            {t('invoice.ksef.fa3GrandTotal', 'Grand total')}
          </div>
          <span className="ksef-fa3-view__total-value">{data.grandTotal}</span>
        </div>
      ) : null}

      {/* KSeF number */}
      {data.ksefNumber !== null ? (
        <div className="slot-row">
          <div>
            <div className="slot-row__label">
              {t('invoice.ksef.fa3KsefNumber', 'KSeF number (FA(3))')}
            </div>
            <div className="slot-row__hint">
              {t('invoice.ksef.fa3KsefNumberHint', 'Embedded in the issued document')}
            </div>
          </div>
          <span className="mono-text text-sm">{data.ksefNumber}</span>
        </div>
      ) : null}
    </div>
  );
}
