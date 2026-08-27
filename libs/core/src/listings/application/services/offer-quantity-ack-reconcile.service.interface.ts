/**
 * Offer Quantity Ack Reconcile Service Interface
 *
 * Contract for reconciling a connection's outstanding asynchronously-
 * acknowledged quantity writes (#2621) — the counterpart, for destinations
 * that acknowledge a quantity write asynchronously, to the synchronous
 * `updateOfferQuantity`/`updateOfferQuantitiesBatch` path.
 *
 * @module libs/core/src/listings/application/services
 */
import type { PendingQuantityAckReconcileResult } from '../../domain/types/offer-quantity-update.types';

export interface IOfferQuantityAckReconcileService {
  /**
   * Reconciles up to `limit` of `connectionId`'s outstanding
   * asynchronously-acknowledged quantity writes. No-ops (returns zeroed
   * counts) for a connection whose adapter doesn't implement
   * `PendingQuantityAckReconciler`.
   */
  reconcile(connectionId: string, limit: number): Promise<PendingQuantityAckReconcileResult>;
}
