/**
 * Shop Category Browse Service Interface (#1834)
 *
 * Contract for the core read service that returns a shop connection's existing
 * category tree, one parent level at a time. Implemented by
 * `ShopCategoryBrowseService`; consumed by the HTTP layer so the FE publish edit
 * flow can render a drill-down category picker for a browsable shop destination
 * (the shop-side analogue of the marketplace category browse used by the offer
 * wizard).
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { ShopCategory } from '@openlinker/core/listings';

export interface IShopCategoryBrowseService {
  /**
   * Return the category nodes under `parentId` for a shop connection. Omit
   * `parentId` to list root-level categories.
   *
   * Resolves the connection's `ProductPublisher` adapter, narrows it to the
   * `ShopCategoryBrowser` sub-capability, and returns the live nodes.
   *
   * Throws:
   * - `ConnectionNotFoundException` (→ HTTP 404) when the connection does not exist.
   * - `ConnectionDisabledException` (→ HTTP 409) when the connection is disabled.
   * - `CapabilityNotSupportedException` (→ HTTP 422) when the connection's
   *   adapter does not implement `ProductPublisher` at all.
   * - `UnprocessableEntityException` (→ HTTP 422) when the adapter supports
   *   `ProductPublisher` but does not implement `browseCategories`.
   */
  browseCategories(connectionId: string, parentId?: string): Promise<ShopCategory[]>;
}
