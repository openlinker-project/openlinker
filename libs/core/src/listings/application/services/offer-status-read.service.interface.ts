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
import type { OfferPublicationStatusView } from '../../domain/types/offer-status-read.types';

export interface IOfferStatusReadService {
  /**
   * Return one row per offer mapped to a variant of `productId`, optionally
   * scoped to a single connection, carrying its snapshot when one exists.
   *
   * An offer that has never been read reports `publicationStatus: null` rather
   * than being omitted (#2039) — otherwise "this product has no offers" and
   * "its offers have no status yet" were the same empty response, and the
   * per-offer manual refresh that fixes the second case was unreachable.
   * `[]` therefore means the product genuinely has no mapped offers and no
   * snapshot history.
   */
  getPublicationStatusForProduct(
    productId: string,
    connectionId?: string
  ): Promise<OfferPublicationStatusView[]>;
}
