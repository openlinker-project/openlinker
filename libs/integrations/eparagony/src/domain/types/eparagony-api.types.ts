/**
 * eparagony.pl Wire Types
 *
 * Request and response shapes for the Documents REST API v3, transcribed from
 * the vendor's OpenAPI contract (spec revision `20260311`).
 *
 * ONE ENDPOINT, SEVERAL DOCUMENT KINDS. `POST /documents` serves receipts and
 * invoices alike; the kind is chosen by WHICH object the body carries
 * (`eReceipt` | `eInvoice` | `eCorrectiveInvoice` | ...), and they are mutually
 * exclusive in one request. `GET /documents/{documentToken}/status` serves both
 * with the same token, which is why one tolerant status type covers both lanes.
 *
 * TWO RULES GOVERN EVERY TYPE HERE, and both come from the vendor stating that
 * the contract is not frozen:
 *
 *   1. **Response types are read tolerantly.** Every field the adapter reads is
 *      optional here and narrowed at the point of use, so an unknown field is
 *      ignored and a missing one degrades rather than throws. The documented
 *      error-code list is explicitly non-exhaustive - live probing returned
 *      `errorCode: 92` where only `100` was documented - so no code branches on
 *      an error code being a member of a closed set.
 *   2. **Request types are exact.** We send what the contract documents and
 *      nothing else; a stray field is a validation rejection.
 *
 * @module libs/integrations/eparagony/src/domain/types
 */
import type { EparagonyTaxRateCode } from './eparagony-config.types';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** `POST /auth/token` success body. */
export interface EparagonyTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  /** Lifetime in seconds; the vendor's default is 3600. */
  expires_in?: unknown;
  scope?: unknown;
}

// ---------------------------------------------------------------------------
// Create document (receipt)
// ---------------------------------------------------------------------------

/** One taxed product position on the receipt. Amounts are integer **minor units**. */
export interface EparagonyReceiptProductLine {
  type: 'PRODUCT';
  productOrServiceName: string;
  /** Decimal string, precision (22,8). */
  quantity: string;
  unitPrice: number;
  /** `unitPrice x quantity`, before any rebate/markup. */
  totalLineValue: number;
  taxRate: EparagonyTaxRateCode;
  EAN?: string;
  SKU?: string;
  unitOfMeasure?: string;
}

/**
 * A whole-receipt rebate (negative) or markup (positive) line. Carries no
 * `taxRate`, which is what makes the device distribute it proportionally across
 * the rates already on the document - the only honest way to reconcile a
 * buyer-paid total that differs from the sum of the taxed positions without
 * inventing a taxed position of our own.
 */
export interface EparagonyReceiptRebateLine {
  type: 'REBATE';
  /** Integer minor units. Negative = rebate, positive = markup. */
  value: number;
  name?: string;
}

export type EparagonyReceiptLine = EparagonyReceiptProductLine | EparagonyReceiptRebateLine;

export interface EparagonyPaymentEntry {
  paymentForm: string;
  paymentName?: string;
  /** Integer minor units. */
  paidThisForm: number;
}

export interface EparagonyPayment {
  payments: EparagonyPaymentEntry[];
  /** Integer minor units. */
  totalPaid: number;
}

export interface EparagonyReceiptMetadata {
  /** Integer minor units. */
  grossSaleValue: number;
  /** Letter -> rate string for all seven device slots. */
  taxRates: Record<EparagonyTaxRateCode, string>;
  /** ISO-8601 with an explicit offset or a trailing `Z`. */
  orderTime?: string;
  /** ISO-4217. */
  currency?: string;
  orderId?: string;
  merchantDocumentId?: string;
  /**
   * Buyer's tax number - the field that makes a receipt under the threshold
   * count as a simplified invoice in some regimes. A three-branch `oneOf`,
   * regex-only, no checksum, and its third branch carries an explicit
   * "no validation guarantee" disclaimer - so this adapter sends whatever it is
   * given and never pre-judges the shape.
   */
  consumerTIN?: string;
}

export interface EparagonyReceiptBody {
  fiscalize: boolean;
  print: boolean;
  metadata: EparagonyReceiptMetadata;
  lines: EparagonyReceiptLine[];
  payment: EparagonyPayment;
}

/** `POST /documents` body for a receipt (`CreateReceiptDocumentPayload`). */
export interface EparagonyCreateReceiptRequest {
  posId: string;
  /** Caller-supplied UUIDv4; supplying it is what makes the status read locatable. */
  documentToken: string;
  /** Required whenever `documentToken` is supplied. */
  transactionToken: string;
  eReceipt: EparagonyReceiptBody;
}

// ---------------------------------------------------------------------------
// Create document (invoice)
// ---------------------------------------------------------------------------

/**
 * Tax-rate vocabulary an INVOICE line takes. Deliberately NOT the receipt's
 * device-slot letters: an invoice names the rate itself, a receipt names the
 * slot the seller's device has that rate programmed into. The two are different
 * vocabularies for different documents and share no mapping.
 *
 * `23`/`8`/`5`/`3` are percentages. The rest are the regime's zero-rate and
 * out-of-scope markers:
 *   - `ZRD`   zero rate, domestic - the vendor names this the DEFAULT 0%.
 *   - `ZRICS` zero rate, intra-community supply.
 *   - `ZRE`   zero rate, export.
 *   - `EP`    exempt.
 *   - `RCP`   reverse charge (the buyer accounts for the tax).
 *   - `NS1`   not subject to tax, procedure I (the general case).
 *   - `NS2`   not subject to tax, procedure II (a narrow statutory case).
 */
export const EparagonyInvoiceTaxRateValues = [
  '23',
  '8',
  '5',
  '3',
  'ZRD',
  'ZRICS',
  'ZRE',
  'EP',
  'RCP',
  'NS1',
  'NS2',
] as const;
export type EparagonyInvoiceTaxRate = (typeof EparagonyInvoiceTaxRateValues)[number];

/**
 * The subset of {@link EparagonyInvoiceTaxRateValues} that may key
 * `metadata.taxValueByTaxRate`.
 *
 * This is a CONTRACT ASYMMETRY, not an oversight: `netValueByTaxRate` declares
 * all eleven codes, `taxValueByTaxRate` declares only the four percentages.
 * A zero-rated or out-of-scope group carries net value and no tax, so writing a
 * `ZRD: 0` key would be sending a property the schema does not declare - and
 * rule 2 of this module is that request types are exact.
 */
export const EparagonyTaxedInvoiceRateValues = ['23', '8', '5', '3'] as const;
export type EparagonyTaxedInvoiceRate = (typeof EparagonyTaxedInvoiceRateValues)[number];

/**
 * `EntityAddress`. Every one of the five fields below is required by the vendor;
 * `apartment` is the one optional field this adapter populates (the neutral
 * `BuyerAddress.line2` has nowhere else to go).
 *
 * `postalCode` carries a Polish-only pattern (`00-000`) on the vendor's side. It
 * is deliberately NOT pre-validated here - refusing a foreign buyer on our own
 * authority would decide something the vendor is the judge of (ADR-073 decision
 * 5); its rejection arrives as an ordinary `EparagonyApiError`.
 */
export interface EparagonyEntityAddress {
  street: string;
  number: string;
  apartment?: string;
  postalCode: string;
  city: string;
  country: string;
}

/**
 * One invoice line. NET-shaped, which is what `vatCalculationMethod:
 * 'SUM_OF_RATES_NET'` requires - see {@link EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET}.
 * Amounts are integer **minor units**; `taxValue` is required on every line,
 * including a zero-rated one, where it is `0`.
 */
export interface EparagonyInvoiceLine {
  productOrServiceName: string;
  /** Decimal string, precision (22,8) - the same shape the receipt line uses. */
  quantity: string;
  netUnitPrice: number;
  netTotalLineValue: number;
  taxRate: EparagonyInvoiceTaxRate;
  taxValue: number;
}

/**
 * Declared summary method.
 *
 * The vendor offers four (`SUM_OF_LINES_*` / `SUM_OF_RATES_*`, each NET or
 * GROSS) and they change WHICH line fields become required. `SUM_OF_RATES_NET`
 * is the one this adapter sends, for two reasons.
 *
 * First, it is the shape that was verified live against the sandbox - the other
 * three are documented and unexercised, and a conditional required-field rule is
 * exactly the kind of thing to verify rather than infer.
 *
 * Second, the per-RATE summary is the arithmetic that reconciles exactly:
 * `netValueByTaxRate` and `taxValueByTaxRate` are required on every invoice
 * whatever the method, so net has to be derived from the buyer-paid gross in any
 * case, and deriving it once per rate GROUP (rather than once per line and then
 * summing) is what keeps `net + tax === gross` true to the grosz.
 */
export const EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET = 'SUM_OF_RATES_NET';

/**
 * The only value the vendor currently accepts. It documents that no in-document
 * arithmetic is validated yet, and exists so the default can be tightened later
 * without breaking existing integrations.
 */
export const EPARAGONY_CALCULATION_VALIDATION_NONE = 'NONE';

/** `invoiceType` discriminator for `PDVatInvoice` - a constant. */
export const EPARAGONY_INVOICE_TYPE_VAT = 'VAT';

/**
 * The only e-invoicing hub the vendor relays to. It sits on the `eInvoice`
 * object itself (the `PDInvoice` base), NOT inside `extensions` - a natural
 * place to look for it, and the wrong one.
 */
export const EPARAGONY_EINVOICING_HUB_KSEF = 'KSEF';

export interface EparagonyInvoiceMetadata {
  vatCalculationMethod: typeof EPARAGONY_VAT_CALCULATION_SUM_OF_RATES_NET;
  calculationValidation: typeof EPARAGONY_CALCULATION_VALIDATION_NONE;
  /** Integer minor units. */
  grossSaleValue: number;
  /**
   * The SELLER's tax number. Validated against the taxpayer registered on the
   * vendor account rather than by checksum, so a wrong value fails every invoice
   * on the connection rather than one order - which is what makes it connection
   * configuration and not order data.
   */
  merchantTIN: string;
  merchantName?: string;
  merchantAddress?: EparagonyEntityAddress;
  consumerName: string;
  consumerAddress: EparagonyEntityAddress;
  /**
   * The BUYER's tax number. Optional; absent means B2C and the hub receives its
   * own "no identifier" marker. Unlike the receipt's field this one IS
   * checksum-verified when the buyer's country is `PL`, so a malformed value is
   * a reachable rejection rather than a theoretical one.
   */
  consumerTIN?: string;
  netValueByTaxRate: Partial<Record<EparagonyInvoiceTaxRate, number>>;
  /** Always in PLN grosze, even on a foreign-currency invoice. */
  taxValueByTaxRate: Partial<Record<EparagonyTaxedInvoiceRate, number>>;
  /** ISO-4217. Anything other than `PLN` additionally requires `exchangeRate`. */
  currency?: string;
  /** Omitted when OL does not allocate the number; the vendor then generates one. */
  invoiceNumber?: string;
  /** Issue date, `YYYY-MM-DD`. Defaults to the vendor's clock when omitted. */
  invoiceDate?: string;
  /** Date of supply, `YYYY-MM-DD`. Defaults to the vendor's clock when omitted. */
  saleEndDate?: string;
  /** ISO-8601 with an explicit offset or a trailing `Z`. */
  orderTime?: string;
  orderId?: string;
}

/** `PDVatInvoice` - the `eInvoice` object on the create body. */
export interface EparagonyInvoiceBody {
  invoiceType: typeof EPARAGONY_INVOICE_TYPE_VAT;
  /** Present asks for a hub relay; absent issues outside the hub entirely. */
  eInvoicingHub?: typeof EPARAGONY_EINVOICING_HUB_KSEF;
  metadata: EparagonyInvoiceMetadata;
  lines: EparagonyInvoiceLine[];
}

/** `POST /documents` body for an invoice (`CreateVatInvoiceDocumentPayload`). */
export interface EparagonyCreateInvoiceRequest {
  posId: string;
  /** Caller-supplied UUIDv4; supplying it is what makes the status read locatable. */
  documentToken: string;
  /** Required whenever `documentToken` is supplied. */
  transactionToken: string;
  eInvoice: EparagonyInvoiceBody;
}

// ---------------------------------------------------------------------------
// Create document (corrective invoice, #3193)
// ---------------------------------------------------------------------------

/**
 * `PDCorrectiveInvoice.correctedMetadata` - links the correction to its
 * original BY INVOICE NUMBER, never by hub number or `documentToken`: those are
 * the RELAY's and this integration's own identifiers, while the correction
 * references the fiscal document itself.
 */
export interface EparagonyCorrectedInvoiceMetadata {
  /** The ORIGINAL document's legal number. */
  invoiceNumber: string;
  /** The ORIGINAL document's issue date, `YYYY-MM-DD`. */
  invoiceDate: string;
  /** The ORIGINAL document's total, integer minor units. */
  grossSaleValue: number;
}

/**
 * `PDCorrectiveInvoice.correctingMetadata` - the POST-correction state the
 * vendor reconciles the correction against.
 *
 * `merchantName` / `merchantAddress` are REQUIRED here, unlike on
 * {@link EparagonyInvoiceMetadata} where both are optional (on a plain invoice
 * the vendor falls back to the account's own registered name and address). A
 * correction carries no such fallback, which is why
 * `composeCorrectiveInvoiceDocument` refuses a connection that configures
 * neither rather than sending a document the vendor would reject.
 */
export interface EparagonyCorrectingInvoiceMetadata {
  merchantTIN: string;
  merchantName: string;
  merchantAddress: EparagonyEntityAddress;
  consumerName: string;
  consumerAddress: EparagonyEntityAddress;
  /** The CORRECTED (post-correction) document's total, integer minor units. */
  grossSaleValue: number;
}

/**
 * `PDVatCorrectiveInvoice` - the `eCorrectiveInvoice` object on the create
 * body. `metadata` is the correction's OWN document (its `invoiceNumber` is the
 * correction's new number, its `netValueByTaxRate` / `taxValueByTaxRate`
 * describe the CORRECTED, post-correction state).
 *
 * `lines` is deliberately ABSENT at this level - unlike {@link
 * EparagonyInvoiceBody}, a `PDVatCorrectiveInvoice` states only `invoiceType` /
 * `metadata` / `correctedMetadata` / `correctingMetadata` as required, with
 * `correctedLines` / `correctingLines` the optional per-line detail.
 */
export interface EparagonyCorrectiveInvoiceBody {
  invoiceType: typeof EPARAGONY_INVOICE_TYPE_VAT;
  /** Present asks for a hub relay; absent issues outside the hub entirely. */
  eInvoicingHub?: typeof EPARAGONY_EINVOICING_HUB_KSEF;
  metadata: EparagonyInvoiceMetadata;
  correctedMetadata: EparagonyCorrectedInvoiceMetadata;
  correctingMetadata: EparagonyCorrectingInvoiceMetadata;
  /** ORIGINAL ("before") lines, for audit; optional. */
  correctedLines?: EparagonyInvoiceLine[];
  /** CORRECTED ("after") lines; optional. */
  correctingLines?: EparagonyInvoiceLine[];
  correctionReason?: string;
}

/** `POST /documents` body for a correction (`CreateCorrectiveInvoiceDocumentPayload`). */
export interface EparagonyCreateCorrectiveInvoiceRequest {
  posId: string;
  /** Caller-supplied UUIDv4; supplying it is what makes the status read locatable. */
  documentToken: string;
  /** Required whenever `documentToken` is supplied. */
  transactionToken: string;
  eCorrectiveInvoice: EparagonyCorrectiveInvoiceBody;
}

/** `CreateDocumentSuccess` - returned on both `200` and `202`. */
export interface EparagonyCreateDocumentResponse {
  transactionToken?: unknown;
  documentToken?: unknown;
  documentPublicUrl?: unknown;
  documentStatusUrl?: unknown;
}

// ---------------------------------------------------------------------------
// Document status
// ---------------------------------------------------------------------------

/**
 * Statuses the two document lanes report. An unrecognised status string is
 * treated as non-terminal by both polls rather than mapped, which is why this
 * stays a plain string on the response type.
 *
 * `CONFIRMED` and `ERROR` are shared. `READY` is receipt-only (the printer
 * executed the commands but the repository has not accepted the e-document yet).
 * `OFFLINE` is invoice-only and means the document IS issued, with legal effect,
 * and is waiting to reach the hub. `PENDING` occurs on both, transiently.
 */
export const EPARAGONY_STATUS_CONFIRMED = 'CONFIRMED';
export const EPARAGONY_STATUS_READY = 'READY';
export const EPARAGONY_STATUS_PENDING = 'PENDING';
export const EPARAGONY_STATUS_ERROR = 'ERROR';
export const EPARAGONY_STATUS_OFFLINE = 'OFFLINE';

/**
 * `processingMode` on an invoice status. `KSEF` means a hub relay was requested
 * and is under way or done; `NONE` means the invoice was issued outside the hub
 * entirely, which is a complete and successful outcome rather than a pending one.
 * (The receipt lane reports `FISCALIZATION` here, which this adapter never reads.)
 *
 * ONLY `NONE` IS BRANCHED ON, and `KSEF` is declared anyway - the same posture
 * {@link EPARAGONY_STATUS_READY} and {@link EPARAGONY_STATUS_PENDING} already
 * hold in this file, which models the vendor's enums rather than only the values
 * the code tests. `toRegulatoryClearanceResult` deliberately does NOT re-test the
 * mode on a `CONFIRMED` document (a mode this build cannot read would then be
 * routed to the non-terminal `pending-submission`, where the #1121
 * reconciliation would poll a settled document for ever), so there is no
 * comparison for `KSEF` to appear in and inventing one would change behaviour.
 */
export const EPARAGONY_PROCESSING_MODE_KSEF = 'KSEF';
export const EPARAGONY_PROCESSING_MODE_NONE = 'NONE';

/**
 * The hub-side detail block, read tolerantly.
 *
 * Its contents DIFFER BY STATUS and the difference is the whole signal:
 * at `OFFLINE` it carries `issueDate`, `invoiceHash` and the two verification
 * URLs and NO `ksefNumber` (the authority has not assigned one yet); at
 * `CONFIRMED` the number is present. Absent entirely when `processingMode` is
 * `NONE`.
 */
export interface EparagonyKsefInvoiceDetails {
  ksefNumber?: unknown;
  referenceNumber?: unknown;
  sessionReferenceNumber?: unknown;
  invoiceHash?: unknown;
  issueDate?: unknown;
  invoicingDate?: unknown;
  acquisitionDate?: unknown;
  invoiceUrl?: unknown;
  issuerVerificationUrl?: unknown;
}

/** `GET /documents/{documentToken}/status` body, read tolerantly. */
export interface EparagonyDocumentStatusResponse {
  status?: unknown;
  documentType?: unknown;
  processingMode?: unknown;
  transactionToken?: unknown;
  documentToken?: unknown;
  /** `numerUnikatowy/numerDokumentu`. */
  fiscalDocumentId?: unknown;
  /** The device's own unique number. */
  fiscalDeviceUniqueNumber?: unknown;
  fiscalDocumentNumber?: unknown;
  receiptNumber?: unknown;
  merchantDocumentId?: unknown;
  merchantStoreId?: unknown;
  posId?: unknown;
  orderId?: unknown;
  /** Buyer-facing view of the document. Never surfaced before `CONFIRMED`. */
  documentUrl?: unknown;
  printed?: unknown;
  /** UTC creation time of the fiscal document; present on `CONFIRMED`. */
  endTime?: unknown;
  errorCode?: unknown;
  errorDescription?: unknown;
  /** Invoice lane: the legal document number, vendor-generated unless we sent one. */
  invoiceNumber?: unknown;
  /** Invoice lane: {@link EparagonyKsefInvoiceDetails}, absent outside a hub relay. */
  ksefInvoice?: unknown;
}

// ---------------------------------------------------------------------------
// Errors and diagnostics
// ---------------------------------------------------------------------------

/** Common non-2xx body. `errorCode` is an open set - never switch exhaustively. */
export interface EparagonyErrorBody {
  error?: unknown;
  statusCode?: unknown;
  message?: unknown;
  errorCode?: unknown;
  errorDescription?: unknown;
}

/**
 * `errorCode` returned when a document already exists under the token we sent.
 * Not a failure for us: our token is deterministic, so it means our own earlier
 * attempt landed and the status read can resolve the true outcome.
 */
export const EPARAGONY_ERROR_DOCUMENT_ALREADY_EXISTS = 118;

/**
 * `errorCode`s meaning "no document under this token". `92` is
 * UNKNOWN_DOCUMENT_TOKEN as documented for the status read; `100` is the
 * DOCUMENT_NOT_FOUND the vendor documents elsewhere for the same condition.
 * Both are accepted because live probing returned `92` where only `100` was
 * documented - a reminder that this list is a convenience, not a contract.
 */
export const EPARAGONY_ERROR_UNKNOWN_DOCUMENT: readonly number[] = [92, 100];

/** `GET /printers/{fiscalDeviceUniqueNumber}/status` body, read tolerantly. */
export interface EparagonyPrinterStatusResponse {
  status?: unknown;
  lastActiveAt?: unknown;
  crkStatus?: unknown;
}
