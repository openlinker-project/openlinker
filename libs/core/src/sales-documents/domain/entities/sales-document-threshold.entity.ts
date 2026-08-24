/**
 * Sales-Document Threshold Domain Entity (#2170, ADR-041 decision 5 — the
 * "regime pack")
 *
 * A versioned, named legal amount a rule's `orderTotalGross` condition
 * references via `thresholdRef` — never an inline literal, so the legal
 * matrix versions independently of every rule that cites it (a law changing
 * on a date is a new threshold row, not an edit to every rule). Anemic per
 * ADR-011.
 *
 * `ref` is the primary key (a mono string, e.g. `pl-simplified-invoice-2026`)
 * rather than a generated id — it IS the stable, human-readable identifier
 * rules point at.
 *
 * @module libs/core/src/sales-documents/domain/entities
 */
import type { SalesDocumentThresholdComparisonOp } from '../types/sales-document-condition.types';

export class SalesDocumentThreshold {
  constructor(
    public readonly ref: string,
    public readonly amount: number,
    public readonly currency: string,
    public readonly comparisonOp: SalesDocumentThresholdComparisonOp,
    public readonly versionEffectiveFrom: Date,
    public readonly versionEffectiveTo: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
