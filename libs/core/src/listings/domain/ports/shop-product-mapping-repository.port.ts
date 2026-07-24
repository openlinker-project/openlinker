/**
 * Shop Product Mapping Repository Port
 *
 * Defines the read contract for shop-product mapping counts. Queries the
 * identifier_mappings table scoped to entityType = 'ShopProduct' - the
 * variant -> destination-shop-product key written by
 * `ProductPublishExecutionService` on a successful publish (#1042). The
 * shop-side sibling of `OfferMappingRepositoryPort.countByConnectionAndVariants`,
 * used by the destination-aware duplicate guard (#1837) to tell whether a
 * variant is already published to a given online shop.
 *
 * @module libs/core/src/listings/domain/ports
 */

export interface ShopProductMappingRepositoryPort {
  /**
   * Count ShopProduct mappings grouped by `internalId` (variant id) for a
   * connection. Returns a `Map<internalId, count>`; keys with zero mappings are
   * omitted. Mirrors `OfferMappingRepositoryPort.countByConnectionAndVariants`
   * so the two listing kinds share a detection shape.
   */
  countByConnectionAndVariants(
    connectionId: string,
    internalIds: ReadonlyArray<string>
  ): Promise<Map<string, number>>;
}
