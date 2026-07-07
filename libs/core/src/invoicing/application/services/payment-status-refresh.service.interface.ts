/**
 * Payment Status Refresh Service Interface (#1354)
 *
 * Contract for the by-id payment-status refresh triggered by a provider payment
 * webhook (e.g. inFakt's `invoice_marked_as_paid`). The webhook is a TRIGGER, not
 * the source of truth: the service re-reads authoritative provider payment state
 * through the `PaymentStatusReader` sub-capability and writes it onto OL's
 * `InvoiceRecord` projection — it never trusts the webhook body (mirrors the
 * `RegulatoryStatusReader` "read is authoritative" pattern, #1121).
 *
 * @module libs/core/src/invoicing/application/services
 */
import type { PaymentStatus } from '../../domain/types/invoicing.types';

/** Neutral outcome of a single by-id refresh attempt (for logging / callers). */
export const PaymentStatusRefreshOutcomeValues = [
  'updated',
  'unchanged',
  'not-found',
  'unsupported',
] as const;
export type PaymentStatusRefreshOutcome = (typeof PaymentStatusRefreshOutcomeValues)[number];

export interface PaymentStatusRefreshResult {
  /**
   * What happened:
   *  - `updated`: OL's projection payment status changed to `paymentStatus`.
   *  - `unchanged`: the authoritative read matched the stored value (no write).
   *  - `not-found`: no `InvoiceRecord` matched the provider id on the connection.
   *  - `unsupported`: the connection's adapter can't read payment status (no-op).
   */
  outcome: PaymentStatusRefreshOutcome;
  /** The neutral payment status after the refresh; `null` when not read. */
  paymentStatus: PaymentStatus | null;
}

export interface IPaymentStatusRefreshService {
  /**
   * Refresh the payment status of the single document identified by
   * `externalInvoiceId` (the provider's invoice id) on `connectionId`. Resolves
   * the `Invoicing` adapter, narrows to `PaymentStatusReader`, re-reads
   * authoritative state, and persists it when changed. Never throws on a
   * missing record or an adapter without the capability — those return a
   * no-op result (a transport failure from the read still propagates).
   */
  refreshByExternalId(
    connectionId: string,
    externalInvoiceId: string,
  ): Promise<PaymentStatusRefreshResult>;
}
