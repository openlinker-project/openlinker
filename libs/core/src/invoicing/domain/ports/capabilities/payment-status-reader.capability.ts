/**
 * Payment Status Reader Capability (#1354)
 *
 * The READ half of the payment-status seam (ADR-002 sub-capability pattern,
 * ADR-026 country-agnostic). An optional sub-capability of `InvoicingPort`: an
 * invoicing adapter that can read back a provider's payment state of an
 * already-issued document declares `implements PaymentStatusReader`.
 *
 * Why read-only: a provider payment webhook (e.g. inFakt's
 * `invoice_marked_as_paid`) is a TRIGGER, never the source of truth — the
 * refresh service re-reads authoritative provider state through this capability
 * rather than trusting the webhook body (mirrors `RegulatoryStatusReader`, #1121).
 *
 * Call sites resolve the `Invoicing` capability adapter per-connection, then
 * narrow with `isPaymentStatusReader` before invoking — a provider without
 * payment read-back simply doesn't implement it and the refresh is a clean no-op.
 *
 * Neutral-vocabulary litmus (ADR-026): no `paid_date`/`left_to_pay`/`faktura` here.
 *
 * @module libs/core/src/invoicing/domain/ports/capabilities
 */
import type { InvoiceRecord } from '../../entities/invoice-record.entity';
import type { PaymentStatusResult } from '../../types/invoicing.types';
import type { InvoicingPort } from '../invoicing.port';

export interface PaymentStatusReader {
  /**
   * Read the current payment status of an issued document from the provider.
   * Returns the neutral status as data; a transport/infrastructure failure
   * throws for the caller to handle and retry. `record` is the issued
   * `InvoiceRecord` (carries `providerInvoiceId` / `documentType`); the adapter
   * picks what it needs and performs no identifier mapping.
   */
  getPaymentStatus(record: InvoiceRecord): Promise<PaymentStatusResult>;
}

export function isPaymentStatusReader(
  adapter: InvoicingPort,
): adapter is InvoicingPort & PaymentStatusReader {
  return typeof (adapter as Partial<PaymentStatusReader>).getPaymentStatus === 'function';
}
