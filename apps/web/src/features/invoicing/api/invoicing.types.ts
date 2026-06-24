/**
 * Invoicing transport types (#757)
 *
 * Hand-mirrored from the #1119 backend DTOs (FE-001 contract strategy). Closed
 * `as const` enum arrays for the well-known vocabularies; the `documentType`
 * POST field stays an open `string` at the boundary (open-world pass-through,
 * plan §1.7).
 *
 * Verified against `invoicing.controller.ts` `toDto` (lines 315-333): the
 * response DTO OMITS `errorMessage` and `idempotencyKey` (PII / dedup-internal).
 *
 * @module apps/web/src/features/invoicing/api
 */

/** Backend invoice lifecycle statuses (no FE-derived `not-issued` — that is the
 *  absence of a row, modelled as `null` from the query). */
export const InvoiceStatusValues = ['pending', 'issued', 'failed'] as const;
export type InvoiceStatus = (typeof InvoiceStatusValues)[number];

/** Regulatory (KSeF) clearance statuses. `not-applicable` is the verified
 *  default sentinel — the panel's badge gate keys on `!== 'not-applicable'`. */
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
 * Exact field set of `InvoiceRecordResponseDto` (verified against `toDto`
 * lines 317-333). Dates are ISO strings; nullables `| null`.
 * NO `errorMessage`, NO `idempotencyKey`.
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
 * `GET /invoices` query filters (#758 list page). Mirrors the #1119 list
 * endpoint query params and the shape of `WebhookDeliveryFilters`. No tax-id
 * filter — deliberately deferred in #1119 (the projection has no tax-id
 * column). `issuedFrom` / `issuedTo` are ISO 8601 instant strings (the page
 * widens the date-only URL params to UTC bounds before querying).
 */
export interface InvoiceFilters {
  status?: InvoiceStatus;
  connectionId?: string;
  regulatoryStatus?: RegulatoryStatus;
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
