/**
 * Stale Offer Pause Service Interface
 *
 * Contract for the stale-variant offer-pause orchestration (#1689). Given a
 * set of variants newly marked stale at their master, resolves their mapped
 * marketplace offers and zeroes each one's quantity so it stops selling a
 * product/variant that no longer exists — the buyer-protection close of the
 * fail-open gap left by #1599.
 *
 * @module libs/core/src/listings/application/interfaces
 */
import type { StaleOfferPauseResult } from '../../domain/types/stale-offer-pause.types';

export interface IStaleOfferPauseService {
  /**
   * Event-driven trigger: pause the mapped offers for a specific set of
   * variants (e.g. those named in a `master.variant.stale` /
   * `master.product.stale` event). Re-verifies each variant's `isStale` flag
   * immediately before enqueuing — an event racing a reappearance must never
   * zero a live offer. Since #3962 it also takes the variants' shop products
   * off sale; an empty `variantIds` with `internalProductId` (a product-level
   * deletion row) means every variant of that product.
   */
  pauseOffersForVariants(input: {
    variantIds: readonly string[];
    internalProductId?: string;
    correlationId: string;
  }): Promise<StaleOfferPauseResult>;

  /**
   * Reconcile guarantee: page a connection's currently stale-mapped variants
   * (via the persisted `isStale` flag, not the event) and re-assert the
   * pause, for both offers and shop products on that connection. Closes the at-most-once gap left by a lost/undelivered
   * deletion event.
   */
  sweepConnection(
    connectionId: string,
    options: { limit: number }
  ): Promise<StaleOfferPauseResult>;
}
