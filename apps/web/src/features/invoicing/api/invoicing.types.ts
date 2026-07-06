/**
 * Invoicing transport types (#757, redesign #1240)
 *
 * Hand-mirrored from the #1119 backend DTOs (FE-001 contract strategy). Closed
 * `as const` enum arrays for the well-known vocabularies; the `documentType`
 * POST field stays an open `string` at the boundary (open-world pass-through,
 * plan §1.7).
 *
 * Verified against `invoicing.controller.ts` `toDto`: the response DTO OMITS
 * `errorMessage` and `idempotencyKey` (PII / dedup-internal). The W1 #1214 DTO
 * adds the PII-free `failureMode` / `failureCode` / `failureReason` triplet and
 * the `issuing` status.
 *
 * @module apps/web/src/features/invoicing/api
 */

/** Backend invoice lifecycle statuses (no FE-derived `not-issued` — that is the
 *  absence of a row, modelled as `null` from the query). `issuing` (W1 #1214)
 *  is a live-lease in-flight state: an attempt holds the row and no second
 *  attempt can start until it clears or releases — the FE renders it as a
 *  locked state with NO action. */
export const InvoiceStatusValues = ['pending', 'issuing', 'issued', 'failed'] as const;
export type InvoiceStatus = (typeof InvoiceStatusValues)[number];

/** Failure mode discriminator (W1 #1214), present only when `status === 'failed'`.
 *  Drives the fiscal-safety split:
 *   - `rejected` — the provider rejected the request and NOTHING was issued, so
 *     a Retry is safe once the cause is fixed.
 *   - `in-doubt` — the request timed out / was interrupted, so a document may
 *     already exist on the provider. A blind Retry risks a DUPLICATE — the FE
 *     offers "check provider / mark resolved", never a one-click Retry.
 *  Retry is gated on `failureMode === 'rejected'` only; an absent/unknown mode
 *  is treated as in-doubt (fiscal-safe default). */
export const FailureModeValues = ['rejected', 'in-doubt'] as const;
export type FailureMode = (typeof FailureModeValues)[number];

/** PII-free failure-code enum (W1 #1214). Maps to localized operator copy; the
 *  raw provider message is never carried (the DTO omits `errorMessage`). */
export const FailureCodeValues = [
  'buyer-tax-id-invalid',
  'provider-rejected',
  'transport-timeout',
  'provider-error',
] as const;
export type FailureCode = (typeof FailureCodeValues)[number];

/** Regulatory (KSeF) clearance statuses. `not-applicable` is the verified
 *  default sentinel — the panel's badge gate keys on `!== 'not-applicable'`.
 *  Terminal success is `accepted` (KSeF maps 200 → accepted); `cleared` is
 *  reserved for split-clearance regimes and no current provider emits it, so
 *  the FE never renders a `cleared` success label. */
export const RegulatoryStatusValues = [
  'not-applicable',
  'submitted',
  'cleared',
  'accepted',
  'rejected',
] as const;
export type RegulatoryStatus = (typeof RegulatoryStatusValues)[number];

/** Well-known document types. The POST field type stays `string` (open-world);
 *  this list drives only the override dropdown's known options. */
export const DocumentTypeValues = [
  'invoice',
  'receipt',
  'credit-note',
  'corrected',
  'proforma',
  'prepayment',
] as const;
export type DocumentType = (typeof DocumentTypeValues)[number];

/**
 * Exact field set of `InvoiceRecordResponseDto`. Dates are ISO strings;
 * nullables `| null`. NO `errorMessage`, NO `idempotencyKey`.
 *
 * `failureMode` / `failureCode` / `failureReason` (W1 #1214) are non-null only
 * on a `failed` row. `failureReason` is a PII-free sanitized string (e.g. a
 * correlation id), safe to render verbatim.
 */
export interface InvoiceRecord {
  id: string;
  connectionId: string;
  orderId: string;
  providerType: string;
  documentType: string;
  status: InvoiceStatus;
  providerInvoiceId: string | null;
  providerInvoiceNumber: string | null;
  regulatoryStatus: RegulatoryStatus;
  clearanceReference: string | null;
  pdfUrl: string | null;
  failureMode: FailureMode | null;
  failureCode: FailureCode | null;
  failureReason: string | null;
  issuedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `POST /invoices` request body. No `idempotencyKey` in v1 (the controller
 *  owns failed-row dedup — plan §1.1/§7). `buyerTaxId` typed but not surfaced
 *  in the v1 UI. */
export interface IssueInvoiceInput {
  connectionId: string;
  orderId: string;
  documentType?: string;
  buyerTaxId?: { scheme: string; value: string };
}

/**
 * Structured error body shape used to type-narrow `ApiError.details` for the
 * capability-disabled discriminator (plan §2.6). The capability filter emits
 * `{ statusCode, error: <ExceptionName>, message }`.
 */
export interface CapabilityErrorBody {
  error?: string;
  message?: string;
}

/**
 * `GET /invoices` query filters (#758 list page, #1202 tax-id). `taxId` is the
 * neutral with/without-buyer-tax-id presence filter (W5 #1202), served by the
 * denormalized `hasBuyerTaxId` column — a presence concept, not "nip".
 * `issuedFrom` / `issuedTo` are ISO 8601 instant strings (the page widens the
 * date-only URL params to UTC bounds before querying).
 */
export interface InvoiceFilters {
  status?: InvoiceStatus;
  connectionId?: string;
  regulatoryStatus?: RegulatoryStatus;
  taxId?: 'with' | 'without';
  issuedFrom?: string;
  issuedTo?: string;
}

/** `GET /invoices` pagination params (#758). `limit` 1–100 (default 20 on the
 *  backend), `offset` ≥ 0. */
export interface InvoicePagination {
  limit?: number;
  offset?: number;
}

/** `GET /invoices` response envelope (#758). Mirrors `PaginatedWebhookDeliveries`. */
export interface PaginatedInvoices {
  items: InvoiceRecord[];
  total: number;
  limit: number;
  offset: number;
}

/** `POST /invoices/retry` request body (W6 #1245). Only `failed + rejected`
 *  records are retried server-side; every other state is skipped per-id. */
export interface RetryInvoicesInput {
  invoiceIds: string[];
}

/** Per-id outcome of a batch retry (W6 #1245). */
export const RetryOutcomeValues = ['retried', 'skipped'] as const;
export type RetryOutcome = (typeof RetryOutcomeValues)[number];

/** One row of the batch-retry result. `reason` is a neutral, PII-free string
 *  present only on `skipped`. */
export interface RetryInvoiceResult {
  id: string;
  outcome: RetryOutcome;
  reason?: string;
}

/** `POST /invoices/retry` response (W6 #1245): aggregate counts + per-id
 *  outcomes. */
export interface RetryInvoicesResult {
  retried: number;
  skipped: number;
  results: RetryInvoiceResult[];
}

/** `POST /invoices/bulk-issue` request body (#1355). Fans out over the single
 *  issue primitive per order id on one invoicing connection; idempotent per
 *  (connection, order) server-side. At most 100 order ids per request. */
export interface BulkIssueInvoicesInput {
  connectionId: string;
  orderIds: string[];
}

/** Per-order-id outcome of a bulk issue (#1355). */
export const BulkIssueOutcomeValues = ['issued', 'skipped', 'failed'] as const;
export type BulkIssueOutcome = (typeof BulkIssueOutcomeValues)[number];

/** One row of the bulk-issue result. `invoiceId` is present only on `issued`;
 *  `reason` is a neutral, PII-free string present on `skipped` / `failed`. */
export interface BulkIssueInvoiceResult {
  orderId: string;
  outcome: BulkIssueOutcome;
  invoiceId?: string;
  reason?: string;
}

/** `POST /invoices/bulk-issue` response (#1355): aggregate counts + per-id
 *  outcomes. */
export interface BulkIssueInvoicesResult {
  issued: number;
  skipped: number;
  failed: number;
  results: BulkIssueInvoiceResult[];
}

/** One corrected line for `POST /invoices/:invoiceId/correct` (#1241). */
export interface CorrectionLineInput {
  originalLineNumber: number;
  newQuantity?: number;
  newUnitPriceGross?: number;
}

/** `POST /invoices/:invoiceId/correct` request body (#1241). Mirrors
 *  `IssueCorrectionCommand` minus the server-resolved fields. */
export interface IssueCorrectionInput {
  reason?: string;
  lines: CorrectionLineInput[];
  idempotencyKey?: string;
}
