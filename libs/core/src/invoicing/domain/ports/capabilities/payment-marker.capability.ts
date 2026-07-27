/**
 * Payment Marker Capability (#1362)
 *
 * The WRITE half of the payment-status seam (ADR-002 sub-capability pattern,
 * ADR-026 country-agnostic) - the outbound counterpart to `PaymentStatusReader`
 * (#1354). An optional sub-capability of `InvoicingPort`: an invoicing adapter
 * that can push an authoritative "paid" state to the provider for an
 * already-issued document declares `implements PaymentMarker`.
 *
 * Why this exists: some orders are already settled before the invoice is ever
 * issued (e.g. a marketplace order - the buyer paid the marketplace, not the
 * seller's bank account directly). A provider with no bank statement to
 * auto-match against would otherwise show such an invoice as unpaid forever.
 *
 * `markPaid` is a fire-and-confirm write, not a query - a caller that wants
 * OL's own `InvoiceRecord.paymentStatus` projection updated afterward should
 * separately invoke `PaymentStatusReader.getPaymentStatus` (or the
 * `PaymentStatusRefreshService` that wraps it). There is currently no
 * scheduled reconciliation sweep for payment status (unlike regulatory
 * status), so that follow-up read is best-effort, not guaranteed.
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isPaymentMarker` before invoking - a provider without an
 * outbound payment-marking concept simply doesn't implement it.
 *
 * Neutral-vocabulary litmus (ADR-026): no `paid_date`/`left_to_pay`/`faktura` here.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { MarkInvoicePaidCommand } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface PaymentMarker {
  /**
   * Push an authoritative "paid" state to the provider for an already-issued
   * document. A transport/infrastructure failure throws for the caller to
   * handle; a successful call means the provider accepted the mark (which may
   * itself be processed asynchronously provider-side).
   */
  markPaid(cmd: MarkInvoicePaidCommand): Promise<void>;
}

export function isPaymentMarker(
  adapter: InvoicingPort,
): adapter is InvoicingPort & PaymentMarker {
  return typeof (adapter as Partial<PaymentMarker>).markPaid === 'function';
}
