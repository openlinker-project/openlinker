/**
 * Types for KSeF FA(3) XML view (#1228, rebuilt #1526).
 *
 * Parsed projection of an FA(3) document as emitted by the backend builder
 * (`fa3-xml.builder.ts`): party identity + address, invoice dates, currency,
 * lines, per-band VAT aggregates, payment block, and KOR correction metadata.
 *
 * @module plugins/ksef/components
 */

export interface FaLine {
  lineNo: string | null;
  description: string | null;
  unit: string | null;
  quantity: string | null;
  netUnitPrice: string | null;
  netTotal: string | null;
  vatRate: string | null;
  /**
   * FA(3) KOR before/after correction model: `true` when this row carries
   * `<StanPrzed>1</StanPrzed>` (the pre-correction "before" state). A
   * correction document emits one before row per changed line plus every
   * current ("after") line - they must be rendered as two distinct sets, not
   * flattened into one table, or line counts/totals double up (#1364 follow-up).
   */
  isBeforeCorrection: boolean;
}

export interface FaParty {
  /** `DaneIdentyfikacyjne/Nazwa` with `NazwaSkrocona` fallback (foreign docs). */
  name: string | null;
  nip: string | null;
  /** `Adres/AdresL1` + optional `AdresL2`, in display order. */
  addressLines: string[];
  /** `Adres/KodKraju` (ISO 3166-1 alpha-2). */
  countryCode: string | null;
}

export interface FaVatBand {
  /** Display label for the band, e.g. `23%`, `zw`, `np I`. */
  label: string;
  net: string;
  /** `null` for net-only bands (0%, zw, np, oo). */
  tax: string | null;
}

export interface FaPayment {
  /** `Platnosc/TerminPlatnosci/Termin` (a date) when present. */
  termDate: string | null;
  /** Composed `TerminOpis` text (`{Ilosc} {Jednostka}`) when the descriptive branch is used. */
  termDescription: string | null;
  /** `Platnosc/FormaPlatnosci` numeric code `1`-`7`. */
  formCode: string | null;
  /** `Platnosc/RachunekBankowy/NrRB`. */
  bankAccount: string | null;
  /** `Platnosc/Skonto/WarunkiSkonta` - early-payment discount conditions. */
  skontoConditions: string | null;
  /** `Platnosc/Skonto/WysokoscSkonta` - early-payment discount amount. */
  skontoAmount: string | null;
}

export interface FaData {
  /** `Fa/P_2` - the invoice number (NOT `P_1`, which is the issue date). */
  invoiceNumber: string;
  /** `Fa/P_1` - the issue date. */
  issueDate: string | null;
  /** `Fa/P_6` - sale/delivery date, optional. */
  saleDate: string | null;
  /** `Fa/KodWaluty`. */
  currency: string | null;
  /** `Fa/RodzajFaktury` - `VAT` for a plain sale, `KOR` for a correction. */
  invoiceType: string | null;
  seller: FaParty;
  buyer: FaParty;
  lines: FaLine[];
  vatBands: FaVatBand[];
  grandTotal: string | null;
  ksefNumber: string | null;
  /** KOR only: `Fa/PrzyczynaKorekty`. */
  correctionReason: string | null;
  /** KOR only: `Fa/DaneFaKorygowanej/NrFaKorygowanej`. */
  correctedInvoiceNumber: string | null;
  payment: FaPayment | null;
}
