/**
 * Invoice Attachment Service Interface (#3548)
 *
 * Outward contract of the one read that answers "what can I attach for this
 * issued document?" for every provider. See {@link InvoiceAttachment}.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type {
  InvoiceAttachment,
  InvoiceAttachmentSummary,
} from '../../domain/types/invoice-attachment.types';

export interface IInvoiceAttachmentService {
  /**
   * Resolve the attachable form of a document, preferring real bytes over a link.
   *
   * Never throws for a modelled condition. A source the provider does not offer
   * is skipped; a source that FAILS to answer (an unresolvable connection, a
   * provider read that errors) is skipped too, but then the result can no longer
   * be `none` - it is `waiting`, because an outage says nothing about whether a
   * document exists. A document that is not issued, or not cleared yet, also
   * reports `waiting`.
   *
   * @returns `null` when no invoice has this id.
   */
  resolveAttachment(invoiceId: string): Promise<InvoiceAttachment | null>;

  /**
   * The same answer without downloading the document, for a caller that only
   * needs to know what it could attach. A `pdf` is reported when the provider
   * declares it can render one; the bytes are fetched later, on download.
   *
   * @returns `null` when no invoice has this id.
   */
  describeAttachment(invoiceId: string): Promise<InvoiceAttachmentSummary | null>;
}
