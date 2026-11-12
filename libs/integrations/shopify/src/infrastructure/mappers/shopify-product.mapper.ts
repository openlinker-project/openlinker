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
 * stores gross variant prices, transcribed as is. A tax-exclusive shop stores
 * net ones and keeps no tax rate on the product (L-T2), so its net price is
 * grossed up with the rate Shopify itself computes for the sales country
 * (`ShopifyTaxRateReader`), the WooCommerce shape. When that rate is unknown
 * (no `write_draft_orders` scope, several tax lines, no tax region) the shop
 * reports NO price rather than a net figure dressed as gross. The price is the
 * variant's `price`, what the buyer pays in the shop; `compareAtPrice` (the
 * struck-through "was" price) is not carried (decision on #3975, case A05).
 *
 * Category: the Standard Product Taxonomy category, keyed by the tail of its
 * GID (`hg-11-10-5-5`); `ancestorIds` are root-first (verified live) and
 * `fullName` names the same path " > "-separated. `Product.categories` carries
 * the leaf then every ancestor (most specific first), so a category mapping
 * made at any level of the branch resolves (case A15).
 *
 * @module libs/integrations/shopify/src/infrastructure/mappers
 */
import type { Category, Product, ProductVariant, TaxRateResolution } from '@openlinker/core/products';

import { fromShopifyGid } from '../../domain/policies/shopify-gid.policy';
import type {
  ShopifyMediaNode,
  ShopifyProduct,
  ShopifyTaxonomyCategory,
  ShopifyVariant,
  ShopifyWeight,
} from '../../domain/types/shopify-api.types';
import type { ShopifyShopContext } from '../shop-context/shopify-shop-context.provider';

/** Option Shopify gives the sole variant of a product without options. */
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

const NUMERIC_RATE = /^\d+(\.\d+)?$/;

/**
 * What a tax-exclusive shop's net price is multiplied by to state it gross:
 * `1 + rate` for a numeric rate, `1` for an exemption code (nothing is added
 * to what the buyer pays), null when the rate is unknown.
 */
export function shopifyGrossFactor(resolution: TaxRateResolution | null): number | null {
  if (resolution === null || resolution.kind !== 'resolved') {
    return null;
  }
  return NUMERIC_RATE.test(resolution.code) ? 1 + Number(resolution.code) / 100 : 1;
}

/**
 * The gross price of one variant: as stored on a tax-inclusive shop, grossed
 * up and rounded to the cent on a tax-exclusive one, undefined when it cannot
 * be stated.
 */
function grossPrice(raw: string | null | undefined, ctx: ShopifyShopContext, grossFactor: number | null): number | undefined {
  const amount = parseShopifyAmount(raw);
  if (amount === undefined || ctx.taxesIncluded) {
    return amount;
  }
  return grossFactor === null ? undefined : Math.round((amount * grossFactor + Number.EPSILON) * 100) / 100;
}

/** A Money decimal string as a number, or undefined when absent or unparseable. */
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
  const factor = GRAMS_PER_UNIT[weight.unit];
  if (factor === undefined) {
    return undefined;
  }
  return Math.round(weight.value * factor) / 1000;
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
  // `fullName` and the id chain describe one path; a mismatch is a shape not
  // seen live, so only the leaf is returned rather than a mislabelled path.
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

/**
 * The ids a category mapping is looked up by, MOST specific first: the leaf,
 * then each ancestor up to the root. Category resolution takes the first id
 * with a mapping, so an operator can map a whole branch ("Drinkware") once and
 * still override one leaf ("Mugs").
 */
export function shopifyCategoryLookupIds(path: readonly Category[]): string[] {
  return [...path].reverse().map((c) => c.id);
}

/**
 * The shop's category directory: every taxonomy node a product sits in, plus
 * its ancestors, deduplicated and ordered by depth then name. This is what the
 * operator maps to a marketplace - not the whole Standard Product Taxonomy,
 * which is thousands of nodes the shop never uses.
 */
export function shopifyCategoryDirectory(
  categories: ReadonlyArray<ShopifyTaxonomyCategory | null>,
): Category[] {
  const byId = new Map<string, Category>();
  for (const category of categories) {
    for (const node of shopifyCategoryPath(category)) {
      if (!byId.has(node.id)) {
        byId.set(node.id, node);
      }
    }
  }
  return [...byId.values()].sort(
    (a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.name.localeCompare(b.name),
  );
}

/**
 * `grossFactor` is the product's `shopifyGrossFactor`, read only for a
 * tax-exclusive shop (one rate per product: a collection override applies to
 * the whole product).
 */
export function mapShopifyProduct(
  raw: ShopifyProduct,
  ctx: ShopifyShopContext,
  grossFactor: number | null = null,
): Omit<Product, 'id'> {
  const variants = raw.variants.nodes;
  const single = variants.length === 1 ? variants[0] : null;
  const first = variants[0];
  const price = first === undefined ? null : (grossPrice(first.price, ctx, grossFactor) ?? null);
  const weight = shopifyWeightKg(first?.inventoryItem.measurement?.weight);
  const path = shopifyCategoryPath(raw.category);
  const vendor = nonEmpty(raw.vendor);

  return {
    name: nonEmpty(raw.title) ?? `product-${fromShopifyGid(raw.id)}`,
    sku: single === null ? null : nonEmpty(single.sku),
    price,
    description: nonEmpty(raw.descriptionHtml),
    images: mediaUrls(raw.media.nodes),
    currency: ctx.currencyCode,
    categories: shopifyCategoryLookupIds(path),
    ...(path.length === 0 ? {} : { categoryBreadcrumb: path.map((c) => ({ id: c.id, name: c.name })) }),
    ...(vendor === null ? {} : { features: [{ name: 'Vendor', value: vendor }] }),
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
  grossFactor: number | null = null,
): Omit<ProductVariant, 'id'> {
  const barcode = nonEmpty(variant.barcode);
  const price = grossPrice(variant.price, ctx, grossFactor);
  const weight = shopifyWeightKg(variant.inventoryItem.measurement?.weight);
  const images = mediaUrls(variant.media?.nodes);
  return {
    productId,
    sku: nonEmpty(variant.sku),
    attributes: shopifyVariantAttributes(variant),
    ean: barcode,
    gtin: barcode,
    // Empty means "the product gallery applies" (#3586), never "no images".
    images: images.length === 0 ? null : images,
    ...(price === undefined ? {} : { price }),
    ...(weight === undefined ? {} : { weight, weightGrams: Math.round(weight * 1000) }),
  };
}
