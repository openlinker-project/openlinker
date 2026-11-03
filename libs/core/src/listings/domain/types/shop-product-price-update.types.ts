/**
 * Shop Product Price Update Types (#3505, G01-10)
 *
 * The neutral command for the `ShopProductPriceUpdater` sub-capability: a
 * price-only write to an already-published shop product.
 *
 * @module libs/core/src/listings/domain/types
 */

/** A decimal amount in its own currency, already rounded to that currency's minor unit. */
export interface ShopProductPriceAmount {
  amount: string;
  currency: string;
}

export interface UpdateShopProductPriceCommand {
  /** The `ShopProduct` external id — a simple product, or a variation under a parent. */
  externalProductId: string;
  /**
   * The parent product's external id when `externalProductId` is a variation
   * of a grouped (multi-variant) publish; absent for a standalone product.
   */
  externalParentProductId?: string;
  /** The new regular price. */
  price: ShopProductPriceAmount;
  /**
   * The new sale price. Omitted → the shop's current sale price is left as it
   * is; this command never clears one implicitly.
   */
  salePrice?: ShopProductPriceAmount;
  /** Stable across a retry of the same change, for adapters that dedupe writes. */
  idempotencyKey?: string;
}
