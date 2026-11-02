/**
 * Inventory Correction Types (#3566)
 *
 * Vocabulary of the operator's manual stock correction: what the target read
 * reports, what a correction request carries, and what it answers. The closed
 * unions are the machine-readable codes the HTTP layer and the dialog branch on.
 *
 * @module libs/core/src/inventory/domain/types
 */
import type {
  InventoryAdjustmentDisposition,
  InventoryIdempotencySupport,
} from './inventory.types';
import type { InventoryMovementOperatorReason } from './inventory-movement.types';

/** Why a correction target could not be named - nothing was written. */
export const InventoryCorrectionTargetRefusalReasonValues = [
  'no-inventory-master',
  'ambiguous-inventory-master',
  'no-position',
  'unattributed-owner',
  'adapter-unresolved',
] as const;
export type InventoryCorrectionTargetRefusalReason =
  (typeof InventoryCorrectionTargetRefusalReasonValues)[number];

/** Refusals decided before the boundary, beyond the target ones. */
export const InventoryCorrectionPreconditionReasonValues = [
  'master-unreadable',
  'no-change',
  'insufficient-stock',
  'note-required',
  'invalid-quantity',
  'idempotency-key-reused',
] as const;
export type InventoryCorrectionPreconditionReason =
  (typeof InventoryCorrectionPreconditionReasonValues)[number];

/** Known refusals by the master after the boundary was reached. */
export const InventoryCorrectionRefusalReasonValues = [
  'master-refused',
  'master-product-not-found',
  'adapter-unresolved',
] as const;
export type InventoryCorrectionRefusalReason =
  (typeof InventoryCorrectionRefusalReasonValues)[number];

export const InventoryCorrectionModeValues = ['set', 'delta'] as const;
export type InventoryCorrectionMode = (typeof InventoryCorrectionModeValues)[number];

/** D41: a change above this many units needs an explicit confirmation. */
export const INVENTORY_CORRECTION_CONFIRM_ABSOLUTE_UNITS = 50;
/** D41: ... or above this share of the current stock (only when current > 0). */
export const INVENTORY_CORRECTION_CONFIRM_RELATIVE_SHARE = 0.5;

export interface InventoryCorrectionMaster {
  readonly connectionId: string;
  readonly connectionName: string;
  readonly platformType: string;
}

export type InventoryCorrectionTarget =
  | {
      readonly kind: 'ready';
      readonly productId: string;
      readonly productVariantId: string;
      readonly connectionId: string;
      readonly connectionName: string;
      readonly platformType: string;
      /** The owner position's mirrored `availableQuantity`. */
      readonly currentQuantity: number;
    }
  | { readonly kind: 'refused'; readonly reason: InventoryCorrectionTargetRefusalReason };

export interface CorrectStockInput {
  readonly productVariantId: string;
  readonly mode: InventoryCorrectionMode;
  /** `set`: the wanted stock (>= 0). `delta`: the signed change. */
  readonly quantity: number;
  readonly operatorReason: InventoryMovementOperatorReason;
  readonly note?: string | null;
  readonly idempotencyKey?: string;
  readonly confirmLargeChange?: boolean;
  readonly actorUserId: string;
}

export interface InventoryCorrectionAdjustmentOutcome {
  readonly disposition: InventoryAdjustmentDisposition;
  readonly idempotency: InventoryIdempotencySupport;
  /** The master's own instant; `null` when it reports none. Never OpenLinker's clock. */
  readonly appliedAt: Date | null;
}

export type InventoryCorrectionStatus = 'applied' | 'refused' | 'in_doubt';

export interface InventoryCorrectionResult {
  readonly status: InventoryCorrectionStatus;
  readonly movementId: string;
  readonly requestedDelta: number;
  /** `null` where unknown (`in_doubt`, `refused`). */
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  /** `null` when the adapter was not reached, reported nothing, or on a replay. */
  readonly adjustmentOutcome: InventoryCorrectionAdjustmentOutcome | null;
  readonly master: InventoryCorrectionMaster;
  readonly refusal: { readonly reason: string; readonly detail: string | null } | null;
  /** `true` when the idempotency key already existed and nothing was sent again. */
  readonly deduplicated: boolean;
}

/** Whether a change needs D41's explicit confirmation. */
export function requiresLargeChangeConfirmation(delta: number, current: number): boolean {
  const size = Math.abs(delta);
  if (size > INVENTORY_CORRECTION_CONFIRM_ABSOLUTE_UNITS) return true;
  return current > 0 && size > current * INVENTORY_CORRECTION_CONFIRM_RELATIVE_SHARE;
}

/**
 * The master's quantity before a correction, as it must be RECORDED.
 *
 * The adapter write is a DELTA write in both modes, and the master's answer is
 * the only authoritative number: the mirror can be stale and a shop-side sale can
 * land between the pre-write read and the write. So whenever the answer is above
 * zero or the delta is positive, no clamp happened and `after - delta` is exact,
 * independent of any earlier read (a concurrent sale is then not blamed on the
 * operator). An answer of 0 after a removal may be a clamp (only reachable
 * through such a race); the pre-write read is then the best estimate, capped at
 * the removal size because a larger before would contradict landing on exactly 0
 * without a clamp. The recorded delta is `after - before`.
 */
export function resolveRecordedQuantityBefore(input: {
  readonly requestedDelta: number;
  readonly resultingQuantity: number;
  /** The master's quantity read before the write (unused for a positive delta). */
  readonly preWriteMasterQuantity: number;
}): number {
  if (input.resultingQuantity > 0 || input.requestedDelta > 0) {
    return input.resultingQuantity - input.requestedDelta;
  }
  return Math.min(input.preWriteMasterQuantity, -input.requestedDelta);
}
