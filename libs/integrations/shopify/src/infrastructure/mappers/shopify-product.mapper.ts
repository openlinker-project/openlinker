/**
 * Shopify Product Mapper
 *
 * Shopify product / variant -> the neutral `Product` / `ProductVariant`.
 *
 * Variant model: every Shopify product has at least one REAL variant, even a
 * product without options (its one variant is titled "Default Title"), so
 * every variant maps to a `ProductVariant` keyed by its own id and no
 * synthetic variant is ever minted (unlike PrestaShop / WooCommerce).
 *
 * Price (ADR-077): catalogue prices are GROSS. A shop with `taxesIncluded`
 * stores gross variant prices, transcribed as is; a tax-exclusive shop stores
 * net ones, and no tax rate is readable anywhere in the Admin API (L-T2), so
 * that shop reports NO price rather than a net figure dressed as gross.
 *
 * Category: the Standard Product Taxonomy category (`product.category`),
 * keyed by the tail of its GID (`aa-1-13-8`); `ancestorIds` are root-first
 * (verified live), and `fullName` names the same path " > "-separated.
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type { Category, Product, ProductVariant } from '@openlinker/core/products';

import { fromShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type {
  ShopifyMediaNode,
  ShopifyProduct,
  ShopifyTaxonomyCategory,
  ShopifyVariant,
  ShopifyWeight,
} from '../../domain/types/shopify-api.types';
import type { ShopifyShopContext } from '../shop-context/shopify-shop-context.provider';

/** Option name Shopify gives the sole option of a product without options. */
const DEFAULT_OPTION_NAME = 'Title';
const DEFAULT_OPTION_VALUE = 'Default Title';

const GRAMS_PER_UNIT: Readonly<Record<ShopifyWeight['unit'], number>> = {
  KILOGRAMS: 1000,
  GRAMS: 1,
  POUNDS: 453.59237,
  OUNCES: 28.349523125,
};

function nonEmpty(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

export function parseShopifyAmount(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw.trim() === '') {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Weight in kilograms, or undefined when the variant states none (a 0 weight is "not set" on Shopify). */
export function shopifyWeightKg(weight: ShopifyWeight | null | undefined): number | undefined {
  if (weight === null || weight === undefined || !(weight.value > 0)) {
    return undefined;
  }
  const grams = weight.value * GRAMS_PER_UNIT[weight.unit];
  return Math.round(grams) / 1000;
}

function mediaUrls(nodes: readonly ShopifyMediaNode[] | undefined): string[] {
  return (nodes ?? [])
    .map((n) => n.image?.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}

/** Root-to-leaf path of the product's taxonomy category, or [] when it has none. */
export function shopifyCategoryPath(category: ShopifyTaxonomyCategory | null): Category[] {
  if (category === null) {
    return [];
  }
  const names = category.fullName.split(' > ');
  const ids = [...category.ancestorIds, category.id].map(fromShopifyGid);
  // `fullName` and the id chain describe one path; a mismatch means a shape we
  // have not seen, so only the leaf is returned rather than a mislabelled path.
  if (names.length !== ids.length) {
    return [{ id: fromShopifyGid(category.id), name: category.name, depth: 0 }];
  }
  return ids.map((id, depth) => ({
    id,
    name: names[depth],
    depth,
    ...(depth === 0 ? {} : { parentId: ids[depth - 1] }),
  }));
}

export function mapShopifyProduct(raw: ShopifyProduct, ctx: ShopifyShopContext): Omit<Product, 'id'> {
  const variants = raw.variants.nodes;
  const single = variants.length === 1 ? variants[0] : null;
  const first = variants[0];
  const price = first === undefined || !ctx.taxesIncluded ? null : (parseShopifyAmount(first.price) ?? null);
  const weight = shopifyWeightKg(first?.inventoryItem.measurement?.weight);
  const path = shopifyCategoryPath(raw.category);

  return {
    name: nonEmpty(raw.title) ?? `product-${fromShopifyGid(raw.id)}`,
    sku: single === null ? null : nonEmpty(single.sku),
    price,
    description: nonEmpty(raw.descriptionHtml),
    images: mediaUrls(raw.media.nodes),
    currency: ctx.currencyCode,
    categories: path.length === 0 ? [] : [path[path.length - 1].id],
    ...(path.length === 0 ? {} : { categoryBreadcrumb: path.map((c) => ({ id: c.id, name: c.name })) }),
    ...(nonEmpty(raw.vendor) === null ? {} : { features: [{ name: 'Vendor', value: raw.vendor.trim() }] }),
    ...(weight === undefined ? {} : { weight }),
  };
}

/** `{ option: value }`, or null for the "Default Title" variant of a product without options. */
export function shopifyVariantAttributes(variant: ShopifyVariant): Record<string, string> | null {
  const options = variant.selectedOptions.filter(
    (o) => !(o.name === DEFAULT_OPTION_NAME && o.value === DEFAULT_OPTION_VALUE),
  );
  if (options.length === 0) {
    return null;
  }
  return Object.fromEntries(options.map((o) => [o.name, o.value]));
}

export function mapShopifyVariant(
  variant: ShopifyVariant,
  productId: string,
  ctx: ShopifyShopContext,
): Omit<ProductVariant, 'id'> {
  const barcode = nonEmpty(variant.barcode);
  const price = ctx.taxesIncluded ? parseShopifyAmount(variant.price) : undefined;
  const weight = shopifyWeightKg(variant.inventoryItem.measurement?.weight);
  const images = mediaUrls(variant.media?.nodes);
  return {
    productId,
    sku: nonEmpty(variant.sku),
    attributes: shopifyVariantAttributes(variant),
    ean: barcode,
    gtin: barcode,
    images: images.length === 0 ? null : images,
    ...(price === undefined ? {} : { price }),
    ...(weight === undefined ? {} : { weight, weightGrams: Math.round(weight * 1000) }),
  };
}
