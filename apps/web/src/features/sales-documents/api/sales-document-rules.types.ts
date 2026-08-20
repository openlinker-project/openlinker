/**
 * Sales-Document Rules — view types (#2170)
 *
 * FE-local mirror of the backend rule-engine DTOs, matching the
 * `apps/web` never-imports-`@openlinker/core/*` contract strategy already
 * used by `sales-documents.types.ts` (#2159). `SalesDocumentConditionField` /
 * `SalesDocumentThresholdComparisonOp` mirror
 * `SalesDocumentConditionFieldValues` / `SalesDocumentThresholdComparisonOpValues`
 * (`@openlinker/core/sales-documents`) by convention, not by import.
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
  thresholdRef?: string;
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
