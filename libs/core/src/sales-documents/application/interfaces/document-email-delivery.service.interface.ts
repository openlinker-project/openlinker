/**
 * Document Email Delivery Service Interface (#3550)
 *
 * The one place a manual document email is recorded and read back, shared by the
 * invoice and fiscal-receipt send services and by the order timeline read.
 *
 * @module libs/core/src/sales-documents/application/interfaces
 */
import type { DocumentEmailDelivery } from '../../domain/entities/document-email-delivery.entity';
import type { RecordDocumentEmailDeliveryInput } from '../../domain/ports/document-email-delivery-repository.port';

export interface IDocumentEmailDeliveryService {
  /**
   * Record one attempt. Best-effort: a failure to write the timeline row is
   * logged and swallowed, because the email has already gone (or been refused)
   * and a bookkeeping fault must not turn that into an error for the operator.
   * Returns `null` when the row could not be written.
   *
   * The recipient is stored only while `OL_STORE_PII` is on.
   */
  record(input: RecordDocumentEmailDeliveryInput): Promise<DocumentEmailDelivery | null>;

  /** Attempts for one order, newest first. */
  listForOrder(internalOrderId: string): Promise<DocumentEmailDelivery[]>;
}
