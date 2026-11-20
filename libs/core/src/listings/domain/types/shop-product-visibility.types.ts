/**
 * Shop Product Visibility Types (#3962)
 *
 * The neutral command for the `ShopProductVisibilityWriter` sub-capability:
 * take an already-published shop product off sale (hidden, not deleted) or
 * put it back on sale.
 *
 * @module libs/core/src/listings/domain/types
 */

export interface SetShopProductVisibilityCommand {
  /**
   * The `ShopProduct` external id of the product to show or hide. For a
   * grouped (multi-variant) publish this is the PARENT product: a shop hides
   * a whole product, never one variation of it.
   */
  externalProductId: string;
  /** `false` takes the product off sale (draft / inactive); `true` puts it back. */
  visible: boolean;
}
