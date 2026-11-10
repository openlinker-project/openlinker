/**
 * Gifts - API types (#3940)
 *
 * Hand-mirrored from `GiftRuleResponseDto`, `GiftDryRunResponseDto` and the
 * order-edit gift route. The browser bundle does not depend on
 * `@openlinker/core` (#591), so the vocabularies below are copies; the server
 * narrows every value again, so a stale copy degrades to "not recognised"
 * rather than to a wrong write.
 *
 * @module apps/web/src/features/gifts/api
 */
import type { GiftDocumentFormChoice } from '../../gift-documents';

export const GiftRuleStatusValues = ['inactive', 'scheduled', 'active', 'paused', 'ended'] as const;
export type GiftRuleStatus = (typeof GiftRuleStatusValues)[number];

export const GiftRulePauseReasonValues = ['unit-cap', 'gift-out-of-stock'] as const;
export type GiftRulePauseReason = (typeof GiftRulePauseReasonValues)[number];

export interface GiftPerUnit {
  productId: string;
  per: number;
  maxPerOrder: number | null;
}

export interface GiftDefinition {
  productId: string;
  variantId: string;
  quantity: number;
  perUnit: GiftPerUnit | null;
  unitCap: number | null;
  skipIfPresent: boolean;
  doNotCombine: boolean;
  customerLimit: number | null;
  documentForm?: GiftDocumentFormChoice;
}

/** The closed condition vocabulary a gift rule may use (the server narrows the rest away). */
export type GiftRuleCondition =
  | { field: 'containsProduct'; op: 'eq'; value: string }
  | { field: 'orderTotalGross'; op: 'gte'; amount: string; currency: string }
  | { field: 'sourceConnectionIn'; op: 'in'; values: string[] }
  | { field: 'sourceConnection'; op: 'eq'; value: string }
  | { field: 'orderCountry'; op: 'eq'; value: string };

export interface GiftRule {
  id: string;
  name: string;
  isActive: boolean;
  position: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  conditions: GiftRuleCondition[];
  gift: GiftDefinition | null;
  status: GiftRuleStatus;
  pausedReason: GiftRulePauseReason | null;
  pausedAt: string | null;
  unitsGiven: number;
  effectiveCap: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GiftRuleWriteInput {
  name: string;
  conditions: GiftRuleCondition[];
  gift: GiftDefinition;
  isActive?: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface GiftDryRunVerdict {
  ruleId: string;
  ruleName: string;
  isSubject: boolean;
  wouldApply: boolean;
  quantity: number;
  reason: string | null;
  nonFiringReason: string | null;
  supersededByRuleId: string | null;
  retroactivityFloorWaived: boolean;
}

export interface GiftDryRunResult {
  orderId: string;
  evaluatedAt: string;
  verdicts: GiftDryRunVerdict[];
}

export interface GiftEvaluateInput {
  orderId: string;
  ruleId?: string;
  rule?: GiftRuleWriteInput;
}

export interface AddGiftInput {
  variantId: string;
  quantity: number;
  documentForm?: GiftDocumentFormChoice;
  /** Gross unit price per gift unit; required with `custom-price`. */
  documentUnitPrice?: string;
  dryRun?: boolean;
}

export interface GiftAddedOutcome {
  lineKey: string | null;
  salesDocumentExists: boolean;
  reserved: boolean;
  onPickList: boolean;
}

export interface AddGiftResult {
  dryRun: boolean;
  changeId: string | null;
  gift?: GiftAddedOutcome;
}

/** One add-gift firing of an order that did not give its gift (`GET /orders/:id/gift-attention`). */
export interface GiftAttentionEntry {
  runId: string;
  ruleId: string;
  ruleName: string;
  outcome: 'failed' | 'not-applied';
  /** Why no gift was added, as a code; null when none was recorded. */
  reasonCode: string | null;
  dismissed: boolean;
  firedAt: string;
}

export interface GiftAttentionResult {
  items: GiftAttentionEntry[];
  recordingAvailable: boolean;
}
