/**
 * Promotions - API types (#3935)
 *
 * Hand-mirrored from `PromotionResponseDto`, `PromotionDryRunResponseDto` and
 * `PromotionHistoryResponseDto`. The browser bundle does not depend on
 * `@openlinker/core` (#591), so the vocabularies below are copies; the server
 * narrows every value again, so a stale copy degrades to "not recognised"
 * rather than to a wrong write.
 *
 * @module apps/web/src/features/promotions/api
 */
import type { GiftDocumentFormChoice } from '../../gift-documents';

export const PromotionStatusValues = ['inactive', 'scheduled', 'active', 'paused', 'ended'] as const;
export type PromotionStatus = (typeof PromotionStatusValues)[number];

export const PromotionPauseReasonValues = ['unit-cap', 'gift-out-of-stock'] as const;
export type PromotionPauseReason = (typeof PromotionPauseReasonValues)[number];

export const PromotionCombinationModeValues = ['all', 'selected', 'none'] as const;
export type PromotionCombinationMode = (typeof PromotionCombinationModeValues)[number];

/** Which promotions this one stacks with. Stacking needs the consent of both sides. */
export type PromotionCombination =
  | { mode: 'all' }
  | { mode: 'none' }
  | { mode: 'selected'; promotionIds: string[] };

export interface PromotionPerUnit {
  productId: string;
  per: number;
  maxPerOrder: number | null;
}

/** What a promotion gives. Only the free gift exists today; the union is open for more kinds. */
export interface FreeGiftBenefit {
  kind: 'free-gift';
  productId: string;
  variantId: string;
  quantity: number;
  perUnit: PromotionPerUnit | null;
  skipIfPresent: boolean;
  documentForm?: GiftDocumentFormChoice;
  /** A positive decimal string, only with `custom-price`. */
  documentUnitPrice?: string;
}
export type PromotionBenefit = FreeGiftBenefit;

export interface PromotionLimits {
  unitCap: number | null;
  customerLimit: number | null;
}

/** The closed condition vocabulary a promotion may use (the server narrows the rest away). */
export type PromotionCondition =
  | { field: 'containsProduct'; op: 'eq'; value: string }
  | { field: 'orderTotalGross'; op: 'gte'; amount: string; currency: string }
  | { field: 'sourceConnectionIn'; op: 'in'; values: string[] }
  | { field: 'sourceConnection'; op: 'eq'; value: string }
  | { field: 'orderCountry'; op: 'eq'; value: string };

export interface Promotion {
  id: string;
  name: string;
  isActive: boolean;
  position: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  conditions: PromotionCondition[];
  benefit: PromotionBenefit;
  combinesWith: PromotionCombination;
  limits: PromotionLimits;
  status: PromotionStatus;
  pausedReason: PromotionPauseReason | null;
  pausedAt: string | null;
  unitsGiven: number;
  effectiveCap: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionWriteInput {
  name: string;
  conditions: PromotionCondition[];
  benefit: PromotionBenefit;
  isActive?: boolean;
  combinesWith: PromotionCombination;
  limits: PromotionLimits;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface PromotionCustomerLimit {
  limit: number;
  usedByCustomer: number | null;
  wouldExceed: boolean;
}

export interface PromotionDryRunVerdict {
  promotionId: string;
  promotionName: string;
  isSubject: boolean;
  wouldApply: boolean;
  quantity: number;
  reason: string | null;
  nonFiringReason: string | null;
  supersededByPromotionId: string | null;
  customerLimit: PromotionCustomerLimit | null;
  retroactivityFloorWaived: boolean;
}

export interface PromotionDryRunResult {
  orderId: string;
  evaluatedAt: string;
  verdicts: PromotionDryRunVerdict[];
}

export interface PromotionEvaluateInput {
  orderId: string;
  promotionId?: string;
  /** Count the customer limit for this customer instead of the order's own. */
  customerId?: string;
  promotion?: PromotionWriteInput;
}

export interface PromotionHistoryItem {
  id: string;
  internalOrderId: string;
  orderNumber: string | null;
  outcome: 'applied' | 'skipped' | 'failed';
  reasonCode: string | null;
  quantity: number;
  createdAt: string;
}

export interface PromotionHistory {
  items: PromotionHistoryItem[];
}
