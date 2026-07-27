/**
 * Published Variants Service Interface
 *
 * Read contract for the destination-aware duplicate guard (#1837): given a
 * destination connection and a set of variant ids, returns the subset that is
 * already published there - as an `Offer` mapping (marketplace) OR a
 * `ShopProduct` mapping (online shop). Listing mappings are connection-scoped
 * by entity type, so a single connection ever carries only one of the two
 * kinds; the service unions both reads to stay destination-kind-agnostic.
 *
 * @module libs/core/src/listings/application/services
 */

export interface IPublishedVariantsService {
  /**
   * Return the subset of `variantIds` that already have a listing mapping
   * (offer or shop-product) on `connectionId`. Order is not significant; the
   * result is de-duplicated. Empty input returns an empty array without a
   * storage round-trip.
   */
  getPublishedVariantIds(
    connectionId: string,
    variantIds: ReadonlyArray<string>
  ): Promise<string[]>;
}
