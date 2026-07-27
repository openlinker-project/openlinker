/**
 * Offer Status Read Service Interface
 *
 * Operator-facing read of the persisted live marketplace publication status
 * (#1760). Resolves a product's variants and returns their
 * `offer_status_snapshots` — the steady-state (#816) counterpart that the
 * creation record (#447) never revises once terminal. This is the read half
 * that turns the previously write-only snapshot table into an operator surface.
 *
 * @module libs/core/src/listings/application/services
 */
import type { OfferStatusSnapshot } from '../../domain/entities/offer-status-snapshot.entity';

export interface IOfferStatusReadService {
  /**
   * Return the live publication-status snapshots for every offer mapped to a
   * variant of `productId`, optionally scoped to a single connection. Products
   * with no synced offers yield `[]` (rather than a fabricated status).
   */
  getPublicationStatusForProduct(
    productId: string,
    connectionId?: string
  ): Promise<OfferStatusSnapshot[]>;
}
