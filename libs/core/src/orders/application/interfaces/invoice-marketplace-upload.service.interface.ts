/**
 * Invoice Marketplace Upload Service Interface (#3549)
 *
 * Outward contract of the service that attaches an issued sales document to the
 * marketplace order it was issued for, and reports where that stands.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type {
  InvoiceMarketplaceUpload,
  InvoiceMarketplaceUploadFailureCode,
  InvoiceMarketplaceUploadStatus,
} from '../../domain/types/invoice-marketplace-upload.types';

/**
 * What one `upload` call concluded. A discriminated union rather than a status
 * alone, because the callers need three different reactions:
 *
 * - `settled` - an attempt ran and the row records its outcome. `failed` is the
 *   only status whose `failureCode` is set, and the code decides whether a retry
 *   can help (`transient` and `adapter-unresolved` can, `rejected` cannot).
 * - `waiting` - the document is not attachable YET (a KSeF invoice without its
 *   number). Nothing was claimed or persisted, so waiting never inflates the
 *   attempt count or reads as a failure.
 * - `skipped` - there was nothing to do: an unknown invoice or order, or a row
 *   that is already terminal.
 */
export type InvoiceMarketplaceUploadResult =
  | {
      kind: 'settled';
      status: Exclude<InvoiceMarketplaceUploadStatus, 'pending'>;
      failureCode: InvoiceMarketplaceUploadFailureCode | null;
    }
  | { kind: 'waiting' }
  | {
      kind: 'skipped';
      reason: 'invoice-not-found' | 'order-not-found' | 'already-settled';
    };

export interface IInvoiceMarketplaceUploadService {
  /**
   * Attach the invoice's document to the order it was issued for. Never throws
   * for a modelled condition; an unexpected infrastructure error propagates so
   * the job retries it.
   */
  upload(invoiceId: string): Promise<InvoiceMarketplaceUploadResult>;

  /**
   * Queue the upload for an issued invoice. Best-effort and NEVER throws: it is
   * called right after a committed fiscal document and must not be able to
   * disturb it, so an enqueue failure is logged and reported as `failed`.
   *
   * `retry` mints a fresh idempotency key. The first-time key is permanent
   * (`sync_jobs.idempotencyKey` is unique and has no TTL), so an operator's
   * retry under it would silently dedup against the first job.
   */
  enqueueUpload(
    invoiceId: string,
    options?: { retry?: boolean },
  ): Promise<'enqueued' | 'skipped' | 'failed'>;

  /** The upload rows of an invoice, for the status read and the order timeline. */
  getStatus(invoiceId: string): Promise<InvoiceMarketplaceUpload[]>;
}
