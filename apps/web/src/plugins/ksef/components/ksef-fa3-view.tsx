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
 *   - Invoice lines table (line#, description, unit, qty, net price, net total, VAT rate)
 *   - VAT band summary (23%, 8%, 0%)
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

interface FaLine {
  lineNo: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  netUnitPrice: string | null;
  netTotal: string | null;
  vatRate: string | null;
}

interface FaData {
  sellerName: string | null;
  sellerNip: string | null;
  buyerName: string | null;
  buyerNip: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  lines: FaLine[];
  vatNet23: string | null;
  vatTax23: string | null;
  vatNet8: string | null;
  vatTax8: string | null;
  vatNet0: string | null;
  vatTax0: string | null;
  grandTotal: string | null;
  ksefNumber: string | null;
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
  }));

  const vatNet23 = fa ? getText(fa, 'P_13_1') : null;
  const vatTax23 = fa ? getText(fa, 'P_14_1') : null;
  const vatNet8 = fa ? getText(fa, 'P_13_2') : null;
  const vatTax8 = fa ? getText(fa, 'P_14_2') : null;
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
    data.vatNet0 !== null;

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

      {/* Line items */}
      {data.lines.length > 0 ? (
        <div className="ksef-fa3-view__lines">
          <div className="slot-row__label ksef-fa3-view__lines-title">
            {t('invoice.ksef.fa3Lines', 'Invoice lines')}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="lineitems">
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
                {data.lines.map((line, idx) => (
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

      {/* VAT bands */}
      {hasVatBands ? (
        <div className="ksef-fa3-view__vat">
          <div className="slot-row__label ksef-fa3-view__vat-title">
            {t('invoice.ksef.fa3VatSummary', 'VAT summary')}
          </div>
          {data.vatNet23 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">23%</div>
              <span>
                {t('invoice.ksef.fa3VatNet', 'Net')}: {data.vatNet23}
                {data.vatTax23 !== null
                  ? ` · ${t('invoice.ksef.fa3VatTax', 'Tax')}: ${data.vatTax23}`
                  : ''}
              </span>
            </div>
          ) : null}
          {data.vatNet8 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">8%</div>
              <span>
                {t('invoice.ksef.fa3VatNet', 'Net')}: {data.vatNet8}
                {data.vatTax8 !== null
                  ? ` · ${t('invoice.ksef.fa3VatTax', 'Tax')}: ${data.vatTax8}`
                  : ''}
              </span>
            </div>
          ) : null}
          {data.vatNet0 !== null ? (
            <div className="slot-row">
              <div className="slot-row__label">0%</div>
              <span>
                {t('invoice.ksef.fa3VatNet', 'Net')}: {data.vatNet0}
                {data.vatTax0 !== null
                  ? ` · ${t('invoice.ksef.fa3VatTax', 'Tax')}: ${data.vatTax0}`
                  : ''}
              </span>
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
