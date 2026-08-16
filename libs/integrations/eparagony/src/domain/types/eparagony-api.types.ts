/**
 * eparagony.pl Wire Types
 *
 * Request and response shapes for the Documents REST API v3, transcribed from
 * the vendor's OpenAPI contract.
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
 * Statuses the receipt lane reports. `RECEIVED` and the KSeF-only `OFFLINE` are
 * not receipt-lane values, so they are not modelled - an unrecognised status
 * string is treated as non-terminal by the poll rather than mapped, which is why
 * this stays a plain string on the response type.
 */
export const EPARAGONY_STATUS_CONFIRMED = 'CONFIRMED';
export const EPARAGONY_STATUS_READY = 'READY';
export const EPARAGONY_STATUS_PENDING = 'PENDING';
export const EPARAGONY_STATUS_ERROR = 'ERROR';

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
export const EPARAGONY_ERROR_UNKNOWN_DOCUMENT = [92, 100] as const;

/** `GET /printers/{fiscalDeviceUniqueNumber}/status` body, read tolerantly. */
export interface EparagonyPrinterStatusResponse {
  status?: unknown;
  lastActiveAt?: unknown;
  crkStatus?: unknown;
}
