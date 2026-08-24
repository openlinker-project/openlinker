/**
 * Sales-Document Rule Write Types (#2170)
 *
 * Application-layer input shapes for creating/replacing rows in the three
 * `sales-documents` persistence tables. Kept separate from the read-side
 * `*-order-facts.types.ts` shapes (the evaluator's own reduced input) — these
 * are what a write-path caller (the API-layer service, a starter-template
 * adopt flow) supplies.
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import type { SalesDocumentCondition, SalesDocumentThresholdComparisonOp } from './sales-document-condition.types';

export interface SalesDocumentRuleInput {
  readonly country: string;
  readonly conditions: readonly SalesDocumentCondition[];
  readonly documentKind: string;
  readonly connectionId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly provenance: string | null;
}

export interface SalesDocumentCountryDefaultInput {
  readonly country: string;
  readonly documentKind: string;
  readonly connectionId: string;
}

export interface SalesDocumentThresholdInput {
  readonly ref: string;
  readonly amount: number;
  readonly currency: string;
  readonly comparisonOp: SalesDocumentThresholdComparisonOp;
  readonly versionEffectiveFrom: Date;
  readonly versionEffectiveTo: Date | null;
}
