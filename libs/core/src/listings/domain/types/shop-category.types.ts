/**
 * Shop Category Types
 *
 * Neutral category node returned by `ShopCategoryBrowser.browseCategories` —
 * the shop-side analogue of `OfferCategory` (marketplace `CategoryBrowser`).
 * Deliberately minimal: unlike a marketplace's closed leaf-gated taxonomy, a
 * shop lets an operator assign a product to any category node (parent or
 * child), so there is no `leaf` flag — every node is a valid selection target
 * and may also have children to drill into.
 *
 * @module libs/core/src/listings/domain/types
 * @see {@link ShopCategoryBrowser} for the capability that returns these.
 */

export interface ShopCategory {
  /** Destination-native category id (e.g. a WooCommerce category term id). */
  id: string;
  /** Human-readable category name. */
  name: string;
  /** Parent category id, or `null` for a root-level category. */
  parentId: string | null;
}
