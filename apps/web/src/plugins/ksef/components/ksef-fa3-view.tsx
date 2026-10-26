/**
 * KsefFa3View
 *
 * Document-styled, theme-aware preview of an FA(3) XML invoice mirroring the
 * official KSeF/MF visualization (#1526, originally #1228). Parses the XML
 * client-side using `DOMParser` - no server round-trip required.
 *
 * Displays:
 *   - Header: invoice number (P_2), invoice type subtitle (RodzajFaktury),
 *     KSeF assigned number when known (passed by the parent from the
 *     InvoiceRecord; the builder does not embed it in the document)
 *   - Two-column Seller/Buyer blocks with NIP and address
 *   - Details row: issue date (P_1), sale date (P_6), currency (KodWaluty)
 *   - Line-items table with render-derived gross per line; the Unit and
 *     Net unit price columns render only when at least one line in the
 *     given table carries the value (documents issued before the backend
 *     emitted P_8A/P_9A get no dash-only columns)
 *   - VAT summary per band (net / tax / gross) + total due with currency
 *   - Payment section (Platnosc): form label from the 1-7 code map (#1311),
 *     payment term (date or descriptive TerminOpis), bank account, skonto
 *   - KOR: correction reason + corrected-invoice number; `StanPrzed=1`
 *     "before" rows stay in a separate collapsed section (#1364 follow-up)
 *   - KOD I verification QR code (#1579): the legally-required verification
 *     code (kod weryfikacyjny) for invoices handed to buyers outside KSeF,
 *     with the KSeF number as caption. The URL comes from the server, which
 *     builds it from the exact submitted document (DEF-02 / DEF-03 / DEF-15).
 *   - The content the legal-completeness work added (DEF-29): the per-line
 *     exchange rate and the VAT in PLN of a foreign-currency invoice, the
 *     annotations that apply, GTU / procedure markers, the margin-scheme
 *     total, and additional parties.
 *
 * Skipped by design: WZ, amount-in-words, footer.
 *
 * Returns `null` if the XML cannot be parsed or required fields are missing,
 * and calls `onParseError` (if given) so the parent (`ksef-invoice-detail-section`)
 * can fall through to its placeholder/error copy instead of an empty preview area.
 *
 * FA(3) uses XML namespaces and real documents may prefix elements (`tns:`);
 * element lookup matches by `localName` regardless of the prefix or
 * namespace used (see `collectByLocalName`).
 *
 * @module plugins/ksef/components
 */
import { useEffect, useMemo } from 'react';
import type { ReactElement } from 'react';
import { useTranslation } from '../../../shared/i18n';
import { KSEF_FORMA_PLATNOSCI_VALUES } from './ksef-setup.schema';
import type { KsefFormaPlatnosci } from './ksef-setup.schema';
import type {
  FaAdditionalParty,
  FaAnnotation,
  FaData,
  FaLine,
  FaParty,
  FaPayment,
  FaVatBand,
} from './ksef-fa3-view.types';
import { QrCode } from '../../../shared/ui';

interface KsefFa3ViewProps {
  xmlText: string;
  /**
   * KSeF-assigned number from the InvoiceRecord (clearance reference). The
   * FA(3) document itself does not carry it - the number is assigned by the
   * authority AFTER the document is built - so the parent passes it in.
   */
  ksefNumber?: string | null;
  /**
   * The KOD I verification URL, as the server built it from the submitted
   * document. Absent or null renders no QR code - never a guessed one.
   */
  verificationUrl?: string | null;
  /**
   * Notifies the parent when `xmlText` cannot be parsed (or is missing
   * required fields), so it can fall through to its placeholder/error copy
   * instead of leaving an empty preview area. Fired from an effect, not
   * during render, since the parent can't synchronously know the parse
   * outcome without duplicating the parsing logic here.
   */
  onParseError?: () => void;
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
 * Line-table display labels for the `P_12` zero-rate band codes, kept
 * consistent with the VAT-summary band labels above.
 */
const ZERO_RATE_LINE_LABELS: Readonly<Record<string, string>> = {
  '0 KR': '0%',
  '0 WDT': '0% WDT',
  '0 EX': '0% EX',
};

/**
 * `FormaPlatnosci` code (`TFormaPlatnosci`, 1-7) to i18n key + English
 * fallback. Keyed by `KsefFormaPlatnosci` from the setup schema (#1311) so
 * the compiler enforces exhaustiveness against the guarded vocabulary -
 * adding an 8th code to `KSEF_FORMA_PLATNOSCI_VALUES` fails compilation here.
 */
const PAYMENT_FORM_LABELS: Readonly<
  Record<KsefFormaPlatnosci, { key: string; fallback: string }>
> = {
  '1': { key: 'invoice.ksef.fa3PaymentFormCash', fallback: 'Cash' },
  '2': { key: 'invoice.ksef.fa3PaymentFormCard', fallback: 'Card' },
  '3': { key: 'invoice.ksef.fa3PaymentFormVoucher', fallback: 'Voucher' },
  '4': { key: 'invoice.ksef.fa3PaymentFormCheque', fallback: 'Cheque' },
  '5': { key: 'invoice.ksef.fa3PaymentFormCredit', fallback: 'Credit' },
  '6': { key: 'invoice.ksef.fa3PaymentFormTransfer', fallback: 'Transfer' },
  '7': { key: 'invoice.ksef.fa3PaymentFormMobile', fallback: 'Mobile' },
};

function isKsefFormaPlatnosci(code: string): code is KsefFormaPlatnosci {
  return (KSEF_FORMA_PLATNOSCI_VALUES as readonly string[]).includes(code);
}

/**
 * Collect descendant elements matching a local name, ignoring namespace
 * prefixes. `getElementsByTagName('Faktura')` does NOT match `<tns:Faktura>`
 * (the qualified-name comparison includes the prefix), and happy-dom's
 * `getElementsByTagNameNS('*', name)` returns nothing even for
 * default-namespace documents, so we filter the `'*'` wildcard - which every
 * DOM implements - by `localName`. FA(3) documents are small, so the linear
 * scan is negligible.
 */
function collectByLocalName(root: Element | Document, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === localName);
}

/** Find the first element matching a local name, ignoring namespace prefixes. */
function firstByLocalName(root: Element | Document, localName: string): Element | null {
  return collectByLocalName(root, localName)[0] ?? null;
}

/** Extract text content from the first matching element (prefix-agnostic). */
function getText(root: Element | Document, localName: string): string | null {
  return firstByLocalName(root, localName)?.textContent?.trim() ?? null;
}

/** Parse a `Podmiot1`/`Podmiot2` element into name + NIP + address. */
function parseParty(podmiot: Element | null): FaParty {
  const idEl = podmiot ? firstByLocalName(podmiot, 'DaneIdentyfikacyjne') : null;
  const adresEl = podmiot ? firstByLocalName(podmiot, 'Adres') : null;
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
  const platnosc = firstByLocalName(fa, 'Platnosc');
  if (!platnosc) return null;
  const terminEl = firstByLocalName(platnosc, 'TerminPlatnosci');
  const termDate = terminEl ? getText(terminEl, 'Termin') : null;
  let termDescription: string | null = null;
  const opisEl = terminEl ? firstByLocalName(terminEl, 'TerminOpis') : null;
  if (opisEl) {
    // The OL builder emits the descriptive branch: `{Ilosc} {Jednostka}`
    // counted from `ZdarzeniePoczatkowe` (e.g. "14 dni").
    const count = getText(opisEl, 'Ilosc');
    const unit = getText(opisEl, 'Jednostka');
    termDescription = [count, unit].filter((part) => part !== null).join(' ') || null;
  }
  const bankEl = firstByLocalName(platnosc, 'RachunekBankowy');
  const skontoEl = firstByLocalName(platnosc, 'Skonto');
  const payment: FaPayment = {
    termDate,
    termDescription,
    formCode: getText(platnosc, 'FormaPlatnosci'),
    bankAccount: bankEl ? getText(bankEl, 'NrRB') : null,
    skontoConditions: skontoEl ? getText(skontoEl, 'WarunkiSkonta') : null,
    skontoAmount: skontoEl ? getText(skontoEl, 'WysokoscSkonta') : null,
  };
  const hasContent = Object.values(payment).some((value) => value !== null);
  return hasContent ? payment : null;
}

/** Display copy for each annotation that applies (DEF-29). */
const ANNOTATION_LABELS: Readonly<Record<FaAnnotation['key'], { key: string; fallback: string }>> = {
  'cash-accounting': { key: 'invoice.ksef.fa3AnnCash', fallback: 'Cash accounting (metoda kasowa)' },
  'self-billing': { key: 'invoice.ksef.fa3AnnSelfBilling', fallback: 'Self-billing (samofakturowanie)' },
  'reverse-charge': { key: 'invoice.ksef.fa3AnnReverseCharge', fallback: 'Reverse charge (odwrotne obciążenie)' },
  'split-payment': {
    key: 'invoice.ksef.fa3AnnSplitPayment',
    fallback: 'Split payment (mechanizm podzielonej płatności)',
  },
  exemption: { key: 'invoice.ksef.fa3AnnExemption', fallback: 'VAT exemption' },
  triangulation: { key: 'invoice.ksef.fa3AnnTriangulation', fallback: 'Triangular transaction (procedura uproszczona)' },
  margin: { key: 'invoice.ksef.fa3AnnMargin', fallback: 'Margin scheme (procedura marży)' },
};

function parseFa3Xml(xmlText: string): FaData | null {
  let doc: Document;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(xmlText, 'application/xml');
    // DOMParser signals parse errors via a <parsererror> element rather than throwing.
    if (collectByLocalName(doc, 'parsererror').length > 0) {
      return null;
    }
  } catch {
    return null;
  }

  // Locate the root <Faktura> element (tag may be namespace-prefixed in real docs).
  const faktura = firstByLocalName(doc, 'Faktura');
  if (!faktura) return null;

  const fa = firstByLocalName(faktura, 'Fa');
  if (!fa) return null;

  // FA(3): P_1 = issue date, P_2 = invoice number (previously swapped, #1526).
  const invoiceNumber = getText(fa, 'P_2');
  // Require at minimum the invoice number to consider the parse successful.
  if (invoiceNumber === null) return null;

  const lineEls = collectByLocalName(fa, 'FaWiersz');
  const lines: FaLine[] = lineEls.map((el) => ({
    lineNo: getText(el, 'NrWierszaFa'),
    description: getText(el, 'P_7'),
    unit: getText(el, 'P_8A'),
    quantity: getText(el, 'P_8B'),
    netUnitPrice: getText(el, 'P_9A'),
    netTotal: getText(el, 'P_11'),
    vatRate: getText(el, 'P_12'),
    grossUnitPrice: getText(el, 'P_9B'),
    grossTotal: getText(el, 'P_11A'),
    gtu: getText(el, 'GTU'),
    procedure: getText(el, 'Procedura'),
    exchangeRate: getText(el, 'KursWaluty'),
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
      taxPln: band.tax !== null ? getText(fa, `${band.tax}W`) : null,
    });
  }

  const korygowanaEl = firstByLocalName(fa, 'DaneFaKorygowanej');
  // The OL builder never embeds the KSeF number (it is assigned post-issue
  // and passed in as a prop) - this parse path only fires for foreign
  // documents that carry a non-schema <KSeF><NrKSeF> extension.
  const ksef = firstByLocalName(faktura, 'KSeF');

  return {
    invoiceNumber,
    issueDate: getText(fa, 'P_1'),
    saleDate: getText(fa, 'P_6'),
    currency: getText(fa, 'KodWaluty'),
    invoiceType: getText(fa, 'RodzajFaktury'),
    seller: parseParty(firstByLocalName(faktura, 'Podmiot1')),
    buyer: parseParty(firstByLocalName(faktura, 'Podmiot2')),
    lines,
    vatBands,
    grandTotal: getText(fa, 'P_15'),
    ksefNumber: ksef ? getText(ksef, 'NrKSeF') : null,
    correctionReason: getText(fa, 'PrzyczynaKorekty'),
    correctedInvoiceNumber: korygowanaEl ? getText(korygowanaEl, 'NrFaKorygowanej') : null,
    // Emitted whenever the corrected original was cleared through KSeF (the
    // normal OL case); the sibling NrKSeF element is only the choice FLAG.
    correctedInvoiceKsefNumber: korygowanaEl
      ? getText(korygowanaEl, 'NrKSeFFaKorygowanej')
      : null,
    payment: parsePayment(fa),
    annotations: parseAnnotations(fa),
    marginTotal: getText(fa, 'P_13_11'),
    additionalParties: collectByLocalName(faktura, 'Podmiot3').map(parseAdditionalParty),
  };
}

/** The `Adnotacje` statements that apply (value `1`), in schema order. */
function parseAnnotations(fa: Element): FaAnnotation[] {
  const adnotacje = firstByLocalName(fa, 'Adnotacje');
  if (!adnotacje) return [];
  const applies = (localName: string): boolean => getText(adnotacje, localName) === '1';
  const out: FaAnnotation[] = [];
  if (applies('P_16')) out.push({ key: 'cash-accounting', detail: null });
  if (applies('P_17')) out.push({ key: 'self-billing', detail: null });
  if (applies('P_18')) out.push({ key: 'reverse-charge', detail: null });
  if (applies('P_18A')) out.push({ key: 'split-payment', detail: null });
  if (applies('P_19')) {
    out.push({
      key: 'exemption',
      detail: getText(adnotacje, 'P_19A') ?? getText(adnotacje, 'P_19B') ?? getText(adnotacje, 'P_19C'),
    });
  }
  if (applies('P_23')) out.push({ key: 'triangulation', detail: null });
  if (applies('P_PMarzy')) {
    const kind = ['P_PMarzy_2', 'P_PMarzy_3_1', 'P_PMarzy_3_2', 'P_PMarzy_3_3'].find(applies) ?? null;
    out.push({ key: 'margin', detail: kind });
  }
  return out;
}

function parseAdditionalParty(podmiot: Element): FaAdditionalParty {
  const dane = firstByLocalName(podmiot, 'DaneIdentyfikacyjne');
  return {
    name: dane ? getText(dane, 'Nazwa') : null,
    nip: dane ? getText(dane, 'NIP') : null,
    role: getText(podmiot, 'Rola'),
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
  const rate =
    vatRate !== null && /^\d+([.,]\d+)?$/.test(vatRate) ? Number(vatRate.replace(',', '.')) : 0;
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

/**
 * Format a `P_12` band for display: numeric bands get a `%` suffix; the
 * `0 KR`/`0 WDT`/`0 EX` codes normalize to the VAT-summary band labels;
 * other non-numeric bands (zw, np, oo) render verbatim.
 */
function formatVatRate(vatRate: string | null): string {
  if (vatRate === null) return '-';
  const zeroLabel = ZERO_RATE_LINE_LABELS[vatRate];
  if (zeroLabel !== undefined) return zeroLabel;
  return /^\d+([.,]\d+)?$/.test(vatRate) ? `${vatRate}%` : vatRate;
}

interface LinesTableProps {
  lines: FaLine[];
}

function LinesTable({ lines }: LinesTableProps): ReactElement {
  const { t } = useTranslation();
  // Documents issued before the backend emitted P_8A/P_9A must not render
  // dash-only columns - show each column only when a line in THIS table
  // carries the value (a KOR's before rows may carry them while the after
  // rows do not, and vice versa).
  const showUnit = lines.some((line) => line.unit !== null);
  const showNetUnitPrice = lines.some((line) => line.netUnitPrice !== null);
  // DEF-29: markers and margin gross values only when a line carries them.
  const showGtu = lines.some((line) => line.gtu !== null);
  const showProcedure = lines.some((line) => line.procedure !== null);
  const showVat = lines.some((line) => line.vatRate !== null);
  return (
    <div className="ksef-fa3-view__table-wrap">
      <table className="ksef-fa3-view__table">
        <thead>
          <tr>
            <th scope="col">{t('invoice.ksef.fa3LineNo', '#')}</th>
            <th scope="col" className="ksef-fa3-view__col-desc">
              {t('invoice.ksef.fa3LineDesc', 'Description')}
            </th>
            {showNetUnitPrice ? (
              <th scope="col" className="ksef-fa3-view__col-num">
                {t('invoice.ksef.fa3LineNetPrice', 'Net unit price')}
              </th>
            ) : null}
            <th scope="col" className="ksef-fa3-view__col-num">
              {t('invoice.ksef.fa3LineQty', 'Qty')}
            </th>
            {showUnit ? <th scope="col">{t('invoice.ksef.fa3LineUnit', 'Unit')}</th> : null}
            {showVat ? (
              <th scope="col" className="ksef-fa3-view__col-num">
                {t('invoice.ksef.fa3LineVat', 'VAT rate')}
              </th>
            ) : null}
            {showGtu ? <th scope="col">{t('invoice.ksef.fa3LineGtu', 'GTU')}</th> : null}
            {showProcedure ? (
              <th scope="col">{t('invoice.ksef.fa3LineProcedure', 'Procedure')}</th>
            ) : null}
            <th scope="col" className="ksef-fa3-view__col-num">
              {t('invoice.ksef.fa3LineNetTotal', 'Net total')}
            </th>
            <th scope="col" className="ksef-fa3-view__col-num">
              {t('invoice.ksef.fa3LineGrossTotal', 'Gross total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {/* lineNo '2' and index 2 stringify identically - prefix the index
              fallback so partially-numbered documents can't collide. */}
          {lines.map((line, idx) => (
            <tr key={line.lineNo ?? `idx-${idx}`}>
              <td>{line.lineNo ?? String(idx + 1)}</td>
              <td className="ksef-fa3-view__col-desc">{line.description ?? '-'}</td>
              {showNetUnitPrice ? (
                <td className="ksef-fa3-view__col-num tabular">{line.netUnitPrice ?? '-'}</td>
              ) : null}
              <td className="ksef-fa3-view__col-num tabular">{line.quantity ?? '-'}</td>
              {showUnit ? <td>{line.unit ?? '-'}</td> : null}
              {showVat ? (
                <td className="ksef-fa3-view__col-num tabular">{formatVatRate(line.vatRate)}</td>
              ) : null}
              {showGtu ? <td>{line.gtu ?? '-'}</td> : null}
              {showProcedure ? <td>{line.procedure ?? '-'}</td> : null}
              <td className="ksef-fa3-view__col-num tabular">{line.netTotal ?? '-'}</td>
              <td className="ksef-fa3-view__col-num tabular">
                {line.grossTotal ?? deriveGross(line.netTotal, line.vatRate) ?? '-'}
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
      {party.addressLines.map((line, idx) => (
        // Keyed by position, not content - AdresL1 may equal AdresL2.
        <div key={idx} className="ksef-fa3-view__party-line">
          {line}
        </div>
      ))}
      {party.countryCode !== null ? (
        <div className="ksef-fa3-view__party-line">{party.countryCode}</div>
      ) : null}
    </div>
  );
}

export function KsefFa3View({
  xmlText,
  ksefNumber,
  verificationUrl = null,
  onParseError,
}: KsefFa3ViewProps): ReactElement | null {
  const { t } = useTranslation();
  // The parse is a full DOMParser pass + ~35 subtree scans; the parent
  // re-renders on unrelated state (toasts, query refetches), so memoize.
  const data = useMemo(() => parseFa3Xml(xmlText), [xmlText]);
  useEffect(() => {
    if (!data) onParseError?.();
  }, [data, onParseError]);

  if (!data) return null;

  const isCorrection = data.invoiceType === 'KOR';
  const subtitle = isCorrection
    ? t('invoice.ksef.fa3TypeCorrection', 'Correction invoice')
    : t('invoice.ksef.fa3TypeStandard', 'Standard invoice');

  // Prefer the record-sourced KSeF number (prop); the XML-parsed value only
  // exists for foreign documents carrying a non-schema extension element.
  const displayKsefNumber = ksefNumber ?? data.ksefNumber;

  // A KOR correction emits one "before" row (StanPrzed=1) per changed line
  // plus every current "after" line. The VAT summary / grand total below
  // already reflect only the corrected delta/state, so the main table must
  // too - otherwise line counts and totals double up (#1364 follow-up). The
  // "before" rows are still shown, but in a separate, clearly labeled set.
  const currentLines = data.lines.filter((line) => !line.isBeforeCorrection);
  // One invoice-level rate is stamped on every line, so the first one speaks for all.
  const exchangeRate = data.lines.find((line) => line.exchangeRate !== null)?.exchangeRate ?? null;
  const showTaxPln = data.vatBands.some((band) => band.taxPln !== null);
  const beforeCorrectionLines = data.lines.filter((line) => line.isBeforeCorrection);

  const paymentFormCode = data.payment?.formCode ?? null;
  const paymentFormLabel =
    paymentFormCode !== null && isKsefFormaPlatnosci(paymentFormCode)
      ? PAYMENT_FORM_LABELS[paymentFormCode]
      : null;

  return (
    <div className="ksef-fa3-view">
      {/* Document header */}
      <header className="ksef-fa3-view__header">
        <div>
          <div className="ksef-fa3-view__doc-number mono-text">{data.invoiceNumber}</div>
          <div className="ksef-fa3-view__doc-type">{subtitle}</div>
        </div>
        {displayKsefNumber !== null && displayKsefNumber !== undefined ? (
          <div className="ksef-fa3-view__ksef-number">
            <div className="ksef-fa3-view__field-label">
              {t('invoice.ksef.fa3KsefNumber', 'KSeF number')}
            </div>
            <div className="mono-text text-sm">{displayKsefNumber}</div>
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
        {exchangeRate !== null ? (
          <div>
            <div className="ksef-fa3-view__field-label">
              {t('invoice.ksef.fa3ExchangeRate', 'Exchange rate (NBP)')}
            </div>
            <div className="tabular">{exchangeRate}</div>
          </div>
        ) : null}
      </section>

      {/* DEF-30: parties besides seller and buyer. */}
      {data.additionalParties.length > 0 ? (
        <section className="ksef-fa3-view__annotations">
          <div className="ksef-fa3-view__section-title">
            {t('invoice.ksef.fa3AdditionalParties', 'Other parties')}
          </div>
          <ul>
            {data.additionalParties.map((party, idx) => (
              <li key={idx}>
                {party.name ?? '-'}
                {party.nip !== null ? ` (${t('invoice.ksef.fa3Nip', 'NIP')} ${party.nip})` : ''}
                {party.role !== null
                  ? ` · ${t('invoice.ksef.fa3PartyRole', 'role')} ${party.role}`
                  : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
          {data.correctedInvoiceKsefNumber !== null ? (
            <div>
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3CorrectedKsefNumber', 'KSeF number of corrected invoice')}
              </span>{' '}
              <span className="mono-text">{data.correctedInvoiceKsefNumber}</span>
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
          <LinesTable lines={currentLines} />
        </section>
      ) : null}

      {/* KOR "before correction" lines - shown separately so they never mix
          into the current-state table/totals above. */}
      {beforeCorrectionLines.length > 0 ? (
        <details className="ksef-fa3-view__before-correction">
          <summary className="ksef-fa3-view__section-title">
            {t('invoice.ksef.fa3LinesBefore', 'Lines before correction')}
          </summary>
          <LinesTable lines={beforeCorrectionLines} />
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
                  <th scope="col">{t('invoice.ksef.fa3VatRate', 'Rate')}</th>
                  <th scope="col" className="ksef-fa3-view__col-num">
                    {t('invoice.ksef.fa3VatNet', 'Net')}
                  </th>
                  <th scope="col" className="ksef-fa3-view__col-num">
                    {t('invoice.ksef.fa3VatTax', 'Tax')}
                  </th>
                  {showTaxPln ? (
                    <th scope="col" className="ksef-fa3-view__col-num">
                      {t('invoice.ksef.fa3VatTaxPln', 'Tax (PLN)')}
                    </th>
                  ) : null}
                  <th scope="col" className="ksef-fa3-view__col-num">
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
                    {showTaxPln ? (
                      <td className="ksef-fa3-view__col-num tabular">{band.taxPln ?? '-'}</td>
                    ) : null}
                    <td className="ksef-fa3-view__col-num tabular">{bandGross(band) ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* DEF-31: a margin-scheme invoice totals its sale here instead of VAT bands. */}
      {data.marginTotal !== null ? (
        <div className="ksef-fa3-view__total">
          <span className="ksef-fa3-view__field-label">
            {t('invoice.ksef.fa3MarginTotal', 'Sale under the margin scheme')}
          </span>
          <span className="tabular">{data.marginTotal}</span>
        </div>
      ) : null}

      {/* DEF-29: the annotations that apply; none applying shows nothing. */}
      {data.annotations.length > 0 ? (
        <section className="ksef-fa3-view__annotations">
          <div className="ksef-fa3-view__section-title">
            {t('invoice.ksef.fa3Annotations', 'Annotations')}
          </div>
          <ul>
            {data.annotations.map((annotation) => (
              <li key={annotation.key}>
                {t(ANNOTATION_LABELS[annotation.key].key, ANNOTATION_LABELS[annotation.key].fallback)}
                {annotation.detail !== null && annotation.key === 'exemption'
                  ? `: ${annotation.detail}`
                  : ''}
              </li>
            ))}
          </ul>
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
          {paymentFormCode !== null ? (
            <div className="ksef-fa3-view__payment-row">
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3PaymentForm', 'Payment form')}
              </span>{' '}
              {paymentFormLabel !== null
                ? t(paymentFormLabel.key, paymentFormLabel.fallback)
                : // Unmapped code (future TFormaPlatnosci extension): show the
                  // raw code rather than dropping the row.
                  paymentFormCode}
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
          {data.payment.skontoConditions !== null || data.payment.skontoAmount !== null ? (
            <div className="ksef-fa3-view__payment-row">
              <span className="ksef-fa3-view__field-label">
                {t('invoice.ksef.fa3PaymentSkonto', 'Early-payment discount (skonto)')}
              </span>{' '}
              {[data.payment.skontoAmount, data.payment.skontoConditions]
                .filter((part) => part !== null)
                .join(' - ')}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* KOD I verification code (kod weryfikacyjny) - legally required on any
          copy of a KSeF-cleared invoice handed to the buyer outside KSeF. The
          KSeF number is shown as the caption below the QR. */}
      {verificationUrl !== null ? (
        <section className="ksef-fa3-view__verification">
          <QrCode
            value={verificationUrl}
            size={148}
            ariaLabel={t('invoice.ksef.fa3VerificationQrAlt', 'KSeF invoice verification QR code')}
            className="ksef-fa3-view__verification-qr"
          />
          <div className="ksef-fa3-view__verification-meta">
            <div className="ksef-fa3-view__field-label">
              {t('invoice.ksef.fa3VerificationLabel', 'Verification code')}
            </div>
            {displayKsefNumber !== null && displayKsefNumber !== undefined ? (
              <div className="mono-text text-sm">{displayKsefNumber}</div>
            ) : null}
            <div className="ksef-fa3-view__verification-hint">
              {t(
                'invoice.ksef.fa3VerificationHint',
                'Scan to verify this invoice against the KSeF system.',
              )}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
