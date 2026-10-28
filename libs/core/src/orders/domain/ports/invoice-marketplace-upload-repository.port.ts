/**
 * Invoice Marketplace Upload Repository Port (#3549)
 *
 * Persistence contract for the per-`(invoice, target connection)` upload state.
 * There is deliberately no `save(upload)`: the row has exactly two writers, the
 * attempt claim and the outcome, and each is one narrow guarded statement so a
 * retry racing a first attempt cannot overwrite a settled result.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type {
  InvoiceMarketplaceUpload,
  RecordInvoiceMarketplaceUploadOutcome,
} from '../types/invoice-marketplace-upload.types';

export interface InvoiceMarketplaceUploadRepositoryPort {
  /** Every upload row of an invoice, oldest first. */
  findByInvoiceId(invoiceRecordId: string): Promise<InvoiceMarketplaceUpload[]>;

  /**
   * Claim the next attempt: create the row if absent, otherwise move it back to
   * `pending` and count the attempt - in ONE statement, and only from a state
   * that allows a retry (`failed`, `no-file`) or from a `pending` row whose
   * lease ran out (a crashed attempt). Returns the claimed row, or `null` when
   * the row is terminal or another attempt holds it, which means "nothing to do
   * now", not an error. Two concurrent claims cannot both win.
   */
  claimAttempt(
    invoiceRecordId: string,
    targetConnectionId: string,
  ): Promise<InvoiceMarketplaceUpload | null>;

  /**
   * Settle a claimed attempt. Guarded on `status = 'pending'` AND on the attempt
   * number the claim returned, so neither a row another attempt already settled
   * nor a row a later attempt took over after this one's lease ran out can be
   * overwritten. Returns whether this call applied.
   */
  recordOutcome(
    id: string,
    claimedAttempt: number,
    outcome: RecordInvoiceMarketplaceUploadOutcome,
  ): Promise<boolean>;
}
