/**
 * Shop Category Browser Capability
 *
 * Optional sub-capability of `ShopProductManagerPort` — shop adapters that can
 * enumerate the destination's existing category tree declare
 * `implements ShopCategoryBrowser`. Call sites resolve the shop-listing adapter
 * via `getCapabilityAdapter<ShopProductManagerPort>(connectionId, 'ProductPublisher')`
 * and narrow with `isShopCategoryBrowser(adapter)` before invoking
 * `browseCategories`; after the guard TypeScript knows the method is present.
 *
 * The shop-side sibling of the marketplace `CategoryBrowser` (a sub-capability
 * of `OfferManagerPort`): where a marketplace browses a closed, leaf-gated
 * taxonomy, a shop browses an open tree any node of which is a valid placement
 * target (see `shop-category.types.ts`). Distinct from `CategoryProvisioner`,
 * which *creates* missing nodes from a source path — this only *reads* the tree
 * so an operator can pick an existing category (#1834).
 *
 * Advertised-without-dispatch (ADR-002 / architecture-overview §10): declared in
 * the adapter manifest `supportedCapabilities` purely so host-side discovery can
 * tell it apart, and resolved only by narrowing the dispatched `ProductPublisher`
 * adapter with this guard — never via `getCapabilityAdapter(id, 'ShopCategoryBrowser')`.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 * @see {@link CategoryProvisioner} for the sibling write (create) capability.
 */

import type { ShopCategory } from '../../types/shop-category.types';
import type { ShopProductManagerPort } from '../shop-product-manager.port';

export interface ShopCategoryBrowser {
  /**
   * List the destination's category nodes under `parentId`. Omit `parentId`
   * (or pass `undefined`) to list root-level categories. The adapter pages
   * through the destination's directory internally and returns the full set of
   * direct children for the given parent.
   */
  browseCategories(parentId?: string): Promise<ShopCategory[]>;
}

export function isShopCategoryBrowser(
  adapter: ShopProductManagerPort,
): adapter is ShopProductManagerPort & ShopCategoryBrowser {
  return typeof (adapter as Partial<ShopCategoryBrowser>).browseCategories === 'function';
}
