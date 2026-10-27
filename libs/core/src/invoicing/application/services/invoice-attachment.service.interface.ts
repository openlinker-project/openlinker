/**
 * Invoice Attachment Service Interface (#3548)
 *
 * Outward contract of the one read that answers "what can I attach for this
 * issued document?" for every provider. See {@link InvoiceAttachment}.
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { InvoiceAttachment } from '../../domain/types/invoice-attachment.types';

export interface IInvoiceAttachmentService {
  /**
   * Resolve the attachable form of a document, preferring real bytes over a link.
   *
   * Never throws for a modelled condition: an unknown provider capability, an
   * adapter that cannot be resolved and a provider read that fails all degrade
   * to the next source, ending in `none`. A document that is not issued, or not
   * cleared yet, reports `waiting`.
   *
   * @returns `null` when no invoice has this id.
   */
  resolveAttachment(invoiceId: string): Promise<InvoiceAttachment | null>;
}
