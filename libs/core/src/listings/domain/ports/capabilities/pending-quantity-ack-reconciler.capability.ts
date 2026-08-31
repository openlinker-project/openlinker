/**
 * Pending Quantity Ack Reconciler Capability
 *
 * Optional sub-capability of `OfferManagerPort` (#2621). A destination that
 * acknowledges a quantity write asynchronously (dispatch now, confirm later)
 * declares `implements PendingQuantityAckReconciler` and owns its own
 * outstanding-write bookkeeping internally — core never sees the individual
 * pending records, only an aggregate reconcile result per pass. An adapter
 * that acknowledges synchronously (or doesn't track pending writes at all)
 * simply doesn't implement this; core no-ops for it.
 *
 * Advertised-without-dispatch, mirroring `OfferCreator` / `CategoryBrowser`
 * (see `docs/architecture-overview.md` § Plugin Manager): not a member of
 * `CoreCapabilityValues`, resolved only by narrowing the dispatched
 * `OfferManager` adapter with this guard.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { PendingQuantityAckReconcileResult } from '../../types/offer-quantity-update.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface PendingQuantityAckReconciler {
  /**
   * Reconciles up to `limit` of this connection's outstanding
   * asynchronously-acknowledged quantity writes against the destination's
   * authoritative status, resolving each to a terminal succeeded/failed
   * outcome where possible. Never throws for an individual write's failure —
   * only for a whole-pass infrastructure error.
   */
  reconcilePendingQuantityAcks(limit: number): Promise<PendingQuantityAckReconcileResult>;
}

export function isPendingQuantityAckReconciler(
  adapter: OfferManagerPort
): adapter is OfferManagerPort & PendingQuantityAckReconciler {
  return (
    typeof (adapter as Partial<PendingQuantityAckReconciler>).reconcilePendingQuantityAcks ===
    'function'
  );
}
