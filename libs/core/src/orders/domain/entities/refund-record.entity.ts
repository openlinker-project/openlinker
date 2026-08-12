/**
 * Refund Record Domain Entity
 *
 * Captures that a return/refund/withdrawal happened against an order and how
 * much — capture-only, not a processing workflow (#2036). Mirrors the
 * `InvoiceRecord` satellite-entity shape: a plain UUID primary key (no
 * identifier-mapping involvement, since this is OL-owned data with no
 * external platform id to translate), no FK to `order_records` (existence is
 * verified at the application layer instead, matching `invoice_records`).
 *
 * @module domain/entities
 */
import type { RefundReason } from '../types/refund-record.types';

export class RefundRecord {
  constructor(
    public readonly id: string,
    public readonly internalOrderId: string,
    public readonly amount: string,
    public readonly currency: string,
    public readonly reason: RefundReason,
    public readonly note: string | null,
    public readonly recordedAt: Date,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
