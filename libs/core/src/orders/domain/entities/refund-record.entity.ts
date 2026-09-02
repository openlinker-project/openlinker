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
import type { RefundExecutedBy, RefundReason } from '../types/refund-record.types';

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
    public readonly idempotencyKey: string | null = null,
    /**
     * The return this refund settles, or `null` for a standalone refund (#2371).
     * Trailing with a default so every pre-existing construction site compiles
     * untouched — the column itself has existed since #2327.
     */
    public readonly returnId: string | null = null,
    /**
     * Who moved the money (#2371, ADR-056). Never inferred: OL records that a
     * human refunded out of band rather than claiming it refunded anything.
     */
    public readonly executedBy: RefundExecutedBy = 'operator_out_of_band',
  ) {}
}
