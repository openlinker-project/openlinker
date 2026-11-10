/**
 * What the bundle form knows about a product it was handed (#3624): enough to
 * draw a row, split the price and say how many bundles the stock allows.
 *
 * @module apps/web/src/features/bundles/lib
 */
import type { Product, ProductVariant } from '../../products';

export interface BundleProductChoice {
  variantId: string;
  productId: string;
  name: string;
  sku: string | null;
  /** Gross catalogue price of one unit; `null` when the master gave none. */
  price: number | null;
  currency: string | null;
  /**
   * Units OpenLinker would promise; `null` = unknown (never zero). Taken from
   * the product row, so for a product with several variants it is unknown here
   * rather than a total that is not the variant's own.
   */
  availableToPromise: number | null;
  /** True when this variant is itself a bundle (it cannot be a component). */
  isBundle: boolean;
}

export function toBundleChoice(
  product: Product,
  variant: ProductVariant,
  variantCount: number,
): BundleProductChoice {
  return {
    variantId: variant.id,
    productId: product.id,
    name: product.name,
    sku: variant.sku ?? product.sku,
    price: variant.price ?? product.price,
    currency: product.currency,
    availableToPromise: variantCount === 1 ? (product.availableToPromise ?? null) : null,
    isBundle: product.bundle?.variantId === variant.id,
  };
}

export function variantLabel(variant: ProductVariant): string {
  const attributes = variant.attributes
    ? Object.values(variant.attributes).join(', ')
    : '';
  return [variant.sku, attributes].filter((part) => part && part.length > 0).join(' - ');
}
