/**
 * Order Item Ref Resolver Types
 *
 * Types for OrderItemRefResolverService resolution results.
 *
 * @module libs/core/src/orders/application/services
 */
import type { IncomingOrderItemRef } from '../../domain/types/incoming-order.types';

export interface ResolvedOrderItemProduct {
  internalProductId: string;
  internalVariantId?: string;
}

/**
 * `kind` discriminates WHY resolution failed (#1689):
 * - `'missing_mapping'`: no identifier mapping exists yet for this ref (the
 *   ordinary "not synced yet" case — `awaiting_mapping`).
 * - `'source_deleted'`: the mapped variant is `isStale` — deleted at its
 *   master (#1599) — a permanently unresolvable ref, not a transient gap.
 * - `'multipack_without_bundle'` (#3929): the ref resolved, but the line is a
 *   multipack (`packQuantity > 1`) with no bundle definition. Raised by
 *   ingestion, never by the resolver; it holds the order as `awaiting_mapping`.
 */
export type ItemResolutionFailureKind =
  | 'missing_mapping'
  | 'source_deleted'
  | 'multipack_without_bundle';

export type ItemResolutionResult =
  | ({ resolved: true } & ResolvedOrderItemProduct)
  | {
      resolved: false;
      productRef: IncomingOrderItemRef;
      reason: string;
      kind: ItemResolutionFailureKind;
    };
