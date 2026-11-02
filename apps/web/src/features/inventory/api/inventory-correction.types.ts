/**
 * Manual stock correction wire types (#3567, mockup m6)
 *
 * Mirror of `GET /inventory/:variantId/correction-target` and
 * `POST /inventory/:variantId/adjust`. A refusal decided before the master is
 * reached is a 409 with a `code`; an outcome AFTER the boundary (applied,
 * refused by the master, in doubt) is a 200 carrying `status`.
 *
 * @module apps/web/src/features/inventory/api
 */

export const CorrectionModeValues = ['set', 'delta'] as const;
export type CorrectionMode = (typeof CorrectionModeValues)[number];

export const CorrectionReasonValues = ['count_correction', 'found', 'damaged', 'other'] as const;
export type CorrectionReason = (typeof CorrectionReasonValues)[number];

export const CorrectionTargetRefusalReasonValues = [
  'no-inventory-master',
  'ambiguous-inventory-master',
  'no-position',
  'unattributed-owner',
  'adapter-unresolved',
] as const;
export type CorrectionTargetRefusalReason = (typeof CorrectionTargetRefusalReasonValues)[number];

export interface CorrectionTarget {
  kind: 'ready' | 'refused';
  reason: CorrectionTargetRefusalReason | null;
  productId: string | null;
  productVariantId: string | null;
  connectionId: string | null;
  connectionName: string | null;
  platformType: string | null;
  currentQuantity: number | null;
}

export interface CorrectStockInput {
  mode: CorrectionMode;
  quantity: number;
  operatorReason: CorrectionReason;
  note?: string;
  idempotencyKey?: string;
  confirmLargeChange?: boolean;
}

export type CorrectionStatus = 'applied' | 'refused' | 'in_doubt';

export interface CorrectStockResult {
  status: CorrectionStatus;
  movementId: string;
  requestedDelta: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  adjustmentOutcome: {
    disposition: 'applied' | 'deduplicated';
    idempotency: 'honoured' | 'unsupported' | 'not_requested';
    appliedAt: string | null;
  } | null;
  master: { connectionId: string; connectionName: string; platformType: string };
  refusal: { reason: string; detail: string | null } | null;
  deduplicated: boolean;
}
