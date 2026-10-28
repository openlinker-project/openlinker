/**
 * Invoice marketplace upload types (#3549)
 *
 * The persisted state of attaching an issued sales document to the marketplace
 * order it was issued for. One row per `(invoice record, target connection)`:
 * that pair is the at-most-once claim, and the row is what the operator-facing
 * status chip and the order timeline read.
 *
 * Country-agnostic (ADR-026) and platform-agnostic: it names neither a regime
 * nor a marketplace, only whether the document reached the order.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * - `pending`     - an attempt is claimed or queued and has not settled.
 * - `uploaded`    - the marketplace holds the document. Terminal.
 * - `failed`      - the last attempt did not land; retryable.
 * - `unsupported` - the marketplace cannot take a billing document. Terminal:
 *                   a platform that cannot show a state declines it, which is
 *                   never an error and never retried.
 * - `no-file`     - the document has no file to upload (only a link, or nothing
 *                   attachable). Not terminal: a KSeF invoice that clears later
 *                   gains a PDF, so a retry may find one.
 */
export const InvoiceMarketplaceUploadStatusValues = [
  'pending',
  'uploaded',
  'failed',
  'unsupported',
  'no-file',
] as const;
export type InvoiceMarketplaceUploadStatus = (typeof InvoiceMarketplaceUploadStatusValues)[number];

/**
 * Why an attempt failed, as a stable CODE. Never a provider message: a
 * marketplace error body can carry order data, so the message is logged and
 * only the code is persisted and shown.
 */
export const InvoiceMarketplaceUploadFailureCodeValues = [
  'rejected',
  'transient',
  'adapter-unresolved',
  'order-unmapped',
] as const;
export type InvoiceMarketplaceUploadFailureCode =
  (typeof InvoiceMarketplaceUploadFailureCodeValues)[number];

export interface InvoiceMarketplaceUpload {
  id: string;
  invoiceRecordId: string;
  /** The order-source connection whose marketplace the document goes to. */
  targetConnectionId: string;
  status: InvoiceMarketplaceUploadStatus;
  /** Claimed attempts so far, including the one in flight. */
  attempts: number;
  lastFailureCode: InvoiceMarketplaceUploadFailureCode | null;
  uploadedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecordInvoiceMarketplaceUploadOutcome {
  status: Exclude<InvoiceMarketplaceUploadStatus, 'pending'>;
  lastFailureCode?: InvoiceMarketplaceUploadFailureCode | null;
}

/**
 * States from which a new attempt may be claimed outright. `pending` is NOT one
 * of them: a pending row is an attempt in flight, and a second claim on it would
 * send the same document twice. It is taken over only once its lease
 * ({@link UPLOAD_CLAIM_LEASE_MS}) has run out, which is how a crashed attempt is
 * recovered.
 */
export const CLAIMABLE_UPLOAD_STATUSES: readonly InvoiceMarketplaceUploadStatus[] = [
  'failed',
  'no-file',
];

/**
 * How long a claimed attempt owns its row. Comfortably above one attempt's worst
 * case (resolving the document plus the marketplace calls, each bounded by its
 * HTTP client's own timeout and retries), so a live attempt is never taken over;
 * short enough that a crashed one is retried on the next job run.
 */
export const UPLOAD_CLAIM_LEASE_MS = 15 * 60 * 1000;
