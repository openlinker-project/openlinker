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

/**
 * The draft a composer is about to save, asked about BEFORE it is written
 * (#3190) - so a read-shaped input among write types, deliberately: it is the
 * same draft `SalesDocumentRuleInput` carries, minus the fields the question
 * does not depend on, and keeping the two beside each other is what stops them
 * drifting apart.
 *
 * `conditions` is `unknown[]` rather than the narrowed array, because the
 * detector reports an entry it cannot read as `unreadable-condition` - one of
 * its three outcomes - and narrowing here would drop that entry and turn
 * "could not decide" into a clean answer about a rule the operator did not
 * write.
 */
export interface SalesDocumentRuleOverlapCheckInput {
  readonly country: string;
  readonly conditions: readonly unknown[];
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  /**
   * Set when editing, so a rule is never reported as colliding with itself.
   *
   * No production caller supplies it today: the composer is create-only and
   * there is no `updateRule`. It ships ahead of that consumer on purpose -
   * the same dialog's `onOpenRule` is the edit flow's entry point, and a
   * self-collision on the first edit is the defect this field exists to
   * prevent rather than one to discover later.
   */
  readonly excludeRuleId?: string;
}
