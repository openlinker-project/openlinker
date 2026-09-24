/**
 * Sales-Document Rule Dry-Run Types (#3191)
 *
 * The dry-run input shape: an in-progress, NEVER-PERSISTED rule candidate the
 * rule composer wants "what would this order get" answered for, before
 * `createRule` is ever called. Kept separate from `SalesDocumentRuleInput`
 * (`sales-document-rule-write.types.ts`) because a dry run carries no
 * effective window and no provenance — the candidate is evaluated as though
 * it were always in force everywhere it would be scoped, since an operator
 * authoring a rule is testing its CONDITIONS, not the calendar.
 *
 * Dependency-free leaf file except for the one condition-shape import, so it
 * places no new demand on the concern's zero-outbound-CORE-context-edge
 * property (`docs/architecture-overview.md § Cross-context dependencies in
 * core`).
 *
 * @module libs/core/src/sales-documents/domain/types
 */
import type { SalesDocumentCondition } from './sales-document-condition.types';

/**
 * The reserved rule id the dry-run candidate is stamped with inside the
 * evaluator's rule set. Never a real persisted id, and never collides with
 * one — `sales_document_rules.id` is a generated uuid, and this sentinel is
 * not one. `SalesDocumentDecision.route.ruleId` equal to this value is how a
 * caller tells "the rule I am drafting would match" apart from "an
 * already-saved rule would match".
 */
export const SALES_DOCUMENT_DRY_RUN_CANDIDATE_RULE_ID = '__dry-run-candidate__';

/**
 * The in-progress rule the composer wants tested — never written to
 * `sales_document_rules`. `country` is the scope (market) the candidate would
 * be saved under; it is compared against the sample order's OWN delivery
 * country to decide which real scope (this country, or `★ Rest of world`) the
 * candidate is folded into for evaluation, exactly as it would be once saved.
 */
export interface SalesDocumentDryRunCandidate {
  readonly country: string;
  readonly conditions: readonly SalesDocumentCondition[];
  readonly documentKind: string;
  readonly connectionId: string;
}
