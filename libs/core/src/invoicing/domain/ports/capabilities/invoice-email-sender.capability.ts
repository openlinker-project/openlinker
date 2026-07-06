/**
 * Invoice Email Sender Capability (#1353)
 *
 * Optional sub-capability of `InvoicingPort`: an invoicing adapter whose
 * provider can deliver an already-issued document to the buyer by email
 * declares `implements InvoiceEmailSender`. The provider renders and sends the
 * email itself (e.g. inFakt's `deliver_via_email`) — OpenLinker only triggers
 * the send; it never composes or attaches the document.
 *
 * Neutral-vocabulary litmus (ADR-026, mirrors `BankAccountsReader`): no
 * provider-specific field names here — `SendInvoiceByEmailCommand` carries only
 * the shape every accounting provider's "email this invoice" concept reduces
 * to. The optional `locale` is the neutral document-language choice; the
 * adapter maps it onto the provider's own locale vocabulary.
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isInvoiceEmailSender` before invoking — a provider that cannot
 * send email (or has no email concept) simply doesn't implement it, and the
 * caller degrades to a 501.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoicingPort } from '../invoicing.port';

/** Neutral document-language choice for the emailed invoice. */
export const InvoiceEmailLocaleValues = ['pl', 'en'] as const;
export type InvoiceEmailLocale = (typeof InvoiceEmailLocaleValues)[number];

export interface SendInvoiceByEmailCommand {
  /** The provider-native id of the already-issued document to deliver. */
  externalInvoiceId: string;
  /** Neutral document language; the adapter maps it to the provider's vocabulary. Defaults per-provider when omitted. */
  locale?: InvoiceEmailLocale;
  /** Ask the provider to also send a copy to the seller. */
  sendCopy?: boolean;
}

export interface SendInvoiceByEmailResult {
  /** True when the provider accepted the delivery request. */
  delivered: boolean;
  /**
   * The recipient the send was addressed to, when the provider echoes it
   * back (else null). There is no override input — the provider always uses
   * the buyer's stored email; this is read-only confirmation.
   */
  recipient: string | null;
}

export interface InvoiceEmailSender {
  /** Trigger the provider to render + email the issued document to the buyer. */
  sendByEmail(cmd: SendInvoiceByEmailCommand): Promise<SendInvoiceByEmailResult>;
}

export function isInvoiceEmailSender(
  adapter: InvoicingPort,
): adapter is InvoicingPort & InvoiceEmailSender {
  return typeof (adapter as Partial<InvoiceEmailSender>).sendByEmail === 'function';
}
