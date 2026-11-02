/**
 * Order Document Email Service Interface (#3550, epic #3510)
 *
 * A manual "send this sales document to the buyer", for EVERY provider and for
 * both document kinds. Lives in `orders` rather than `invoicing` because it needs
 * the order (the buyer's address) next to the document, and `InvoicingModule`
 * must not depend on an orders token (the one-way edge F3 protects).
 *
 * ## Properties that are load-bearing
 *
 * 1. **The provider's own email capability is used first, but never at the
 *    operator's expense.** `InvoiceEmailSender` takes no recipient, so it is used
 *    only when the operator left the address alone; an edited recipient is sent
 *    by OpenLinker's mailer, and `sentVia` says which one delivered.
 * 2. **A failed provider send is NOT retried through the mailer.** The provider
 *    may have sent it; a second message to a buyer is worse than a refusal.
 * 3. **A manual send is never refused because the connection's automatic buyer
 *    emails are off** (D6): this service does not read that toggle.
 * 4. **Nothing throws for a modelled condition.** Every refusal is a closed
 *    reason plus a readable `message` the dialog shows verbatim (mockup M24 note
 *    9); a caller branches on `reason`, never on the text. The message never
 *    carries a raw provider or SMTP error, which routinely names a host or holds
 *    a credential fragment.
 * 5. **Every attempt that reaches an order is recorded** (sent or failed), so the
 *    timeline can show it.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { DocumentEmailSentVia } from '@openlinker/core/sales-documents';
import type {
  OrderDocumentEmailLocale,
  OrderDocumentEmailRefusal,
} from '../../domain/types/order-document-email.types';

export type OrderDocumentEmailResult =
  | {
      status: 'sent';
      sentVia: DocumentEmailSentVia;
      /** Where it went; null when the provider did not echo it and none was given. */
      recipient: string | null;
    }
  | { status: 'refused'; reason: OrderDocumentEmailRefusal; message: string };

export interface SendInvoiceEmailInput {
  invoiceId: string;
  /** Overrides the buyer's stored address. Validated server-side. */
  recipient?: string;
  locale?: OrderDocumentEmailLocale;
  /** Honoured only by a provider that sends the message itself. */
  sendCopy?: boolean;
  actorUserId?: string | null;
}

export interface SendReceiptEmailInput {
  registrationId: string;
  recipient?: string;
  locale?: OrderDocumentEmailLocale;
  actorUserId?: string | null;
}

export interface IOrderDocumentEmailService {
  sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<OrderDocumentEmailResult>;

  /**
   * Email a fiscal-receipt registration. The message carries OpenLinker's own
   * summary and the link to the legal e-receipt at the vendor, and says in terms
   * that the summary is not the receipt.
   */
  sendReceiptEmail(input: SendReceiptEmailInput): Promise<OrderDocumentEmailResult>;
}
