/**
 * Sales-Document Rules — view types (#2170)
 *
 * FE-local mirror of the backend rule-engine DTOs, matching the
 * `apps/web` never-imports-`@openlinker/core/*` contract strategy already
 * used by `sales-documents.types.ts` (#2159). `SalesDocumentConditionField` /
 * `SalesDocumentThresholdComparisonOp` mirror
 * `SalesDocumentConditionFieldValues` / `SalesDocumentThresholdComparisonOpValues`
 * (`@openlinker/core/sales-documents`) by re-declaration, not by import. The
 * field vocabulary is held to core by
 * `scripts/check-sales-document-condition-field-mirror.mjs`;
 * the operator vocabulary has no such guard yet.
 *
 * @module apps/web/src/features/sales-documents/api
 */
import type { SalesDocumentKind } from './sales-documents.types';

/** The `★ Rest of world` pseudo-country literal (mirrors `SALES_DOCUMENT_REST_OF_WORLD_COUNTRY`). */
export const SALES_DOCUMENT_REST_OF_WORLD_COUNTRY = '*';

export const SALES_DOCUMENT_CONDITION_FIELD_VALUES = [
  'buyerHasTaxId',
  'orderCountry',
  'orderTotalGross',
] as const;
export type SalesDocumentConditionField = (typeof SALES_DOCUMENT_CONDITION_FIELD_VALUES)[number];

export const SALES_DOCUMENT_THRESHOLD_COMPARISON_OP_VALUES = ['gte', 'lt'] as const;
export type SalesDocumentThresholdComparisonOp =
  (typeof SALES_DOCUMENT_THRESHOLD_COMPARISON_OP_VALUES)[number];

/** Mirrors the backend's `SalesDocumentConditionDto` wire shape. */
export interface SalesDocumentConditionInput {
  field: SalesDocumentConditionField;
  op: 'eq' | SalesDocumentThresholdComparisonOp;
  boolValue?: boolean;
  stringValue?: string;
  /**
   * Decimal string (`'450.00'`) on an `orderTotalGross` condition (#3189).
   * Never a number: it round-trips through jsonb and is shown back verbatim.
   */
  amount?: string;
  /** ISO 4217 on an `orderTotalGross` condition. Compared, never converted. */
  currency?: string;
}

export interface SalesDocumentRule {
  id: string;
  country: string;
  conditions: SalesDocumentConditionInput[];
  documentKind: SalesDocumentKind;
  connectionId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  provenance: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSalesDocumentRuleInput {
  country: string;
  conditions: SalesDocumentConditionInput[];
  documentKind: SalesDocumentKind;
  connectionId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  provenance?: string | null;
}

export interface SalesDocumentCountryDefault {
  id: string;
  country: string;
  documentKind: SalesDocumentKind;
  connectionId: string;
}

export interface UpsertSalesDocumentCountryDefaultInput {
  country: string;
  documentKind: SalesDocumentKind;
  connectionId: string;
}

export interface SalesDocumentThreshold {
  ref: string;
  amount: number;
  currency: string;
  comparisonOp: SalesDocumentThresholdComparisonOp;
  versionEffectiveFrom: string;
  versionEffectiveTo: string | null;
}

/**
 * Mirrors the backend `SalesDocumentCountrySummaryResponseDto` (#2186): one
 * row per country carrying ANY rule, country default, or no-document
 * acknowledgment. A country missing one side is never dropped — `ruleCount`
 * defaults to `0`, the two default fields default to `null`.
 */
export interface SalesDocumentCountrySummary {
  country: string;
  ruleCount: number;
  invoiceDefaultConnectionId: string | null;
  receiptDefaultConnectionId: string | null;
  acknowledgedNoDocumentAt: string | null;
}

/**
 * Mirrors the backend `SalesDocumentCountryAcknowledgmentResponseDto` (#2186):
 * the "no sales document, by design" acknowledgment for one country.
 */
export interface SalesDocumentCountryAcknowledgment {
  country: string;
  acknowledgedAt: string;
}

export interface SalesDocumentTemplateRuleSummary {
  slot: string;
  label: string;
  documentKind: SalesDocumentKind;
  requiredCapability: 'Invoicing' | 'Fiscalization';
  effectiveFrom: string;
  effectiveTo: string | null;
  /** Whether this rule's conditions reference `buyerHasTaxId` — see the backend controller's own doc comment. */
  usesBuyerHasTaxId: boolean;
}

export interface SalesDocumentStarterTemplate {
  country: string;
  sourceLabel: string;
  sourceUrl: string;
  disclaimer: string;
  rules: SalesDocumentTemplateRuleSummary[];
}

export interface AdoptSalesDocumentTemplateInput {
  selections: { slot: string; connectionId: string }[];
}


/**
 * Overlap-check result (#3190). Three outcomes, never two: `undecided` is
 * surfaced rather than folded into `disjoint`, because silence reads as "no
 * conflict" and that is the false reassurance the check exists to remove.
 */
export interface SalesDocumentRuleOverlapVerdict {
  readonly overlapping: readonly {
    readonly ruleId: string;
    readonly connectionId: string;
    readonly documentKind: string;
  }[];
  readonly disjoint: readonly { readonly ruleId: string; readonly reason: string }[];
  readonly undecided: readonly { readonly ruleId: string; readonly reason: string }[];
}

export interface CheckSalesDocumentRuleOverlapInput {
  readonly country: string;
  readonly conditions: SalesDocumentConditionInput[];
  readonly effectiveFrom: string;
  readonly effectiveTo?: string | null;
  readonly excludeRuleId?: string;
}
