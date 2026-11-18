/**
 * Amazon Product Mapper (#4182)
 *
 * Maps the seller's own listing (Listings Items `attributes`, `summaries`,
 * `relationships`) to OpenLinker's `Product` / `ProductVariant`. The listing's
 * own attributes come first; the ASIN's catalogue entry (`AmazonCatalogEntry`)
 * only fills a title, images or EAN the listing does not carry, because the
 * shared detail page is edited by other sellers and Amazon as well.
 *
 *   - price: `purchasable_offer.our_price.value_with_tax` for the marketplace,
 *     which is the gross price a buyer pays (ADR-077); a variation parent has
 *     none and reports no price rather than a guessed one.
 *   - description: the bullet points as a list, then `product_description`.
 *   - category: the listing's product type (one per listing).
 *   - variant attributes: the variation theme's attributes (`color`, `size`)
 *     read off the child listing.
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import type { Product, ProductVariant } from '@openlinker/core/products';

import type { AmazonCatalogEntry } from '../../domain/types/amazon-catalog.types';
import type { AmazonAttributeValue, AmazonListingItem } from '../../domain/types/amazon-listing.types';

const MAX_OTHER_IMAGES = 8;
const GRAMS_PER_UNIT: Readonly<Record<string, number>> = {
  grams: 1,
  kilograms: 1000,
  milligrams: 0.001,
  pounds: 453.59237,
  ounces: 28.349523125,
};

/** The attribute's values for `marketplaceId` (or values carrying no marketplace). */
export function attributeValues(
  item: AmazonListingItem,
  name: string,
  marketplaceId: string,
): AmazonAttributeValue[] {
  const values = item.attributes?.[name] ?? [];
  const local = values.filter((value) => value.marketplace_id === marketplaceId);
  // A value written for another marketplace is still the seller's own: used
  // when the listing carries none for this one.
  return local.length > 0 ? local : [...values];
}

export function attributeText(item: AmazonListingItem, name: string, marketplaceId: string): string | null {
  const value = attributeValues(item, name, marketplaceId)[0]?.value;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return typeof value === 'number' ? String(value) : null;
}

export interface AmazonVariationLinks {
  readonly parentSku: string | null;
  readonly childSkus: readonly string[];
  readonly themeAttributes: readonly string[];
}

export function variationLinks(item: AmazonListingItem, marketplaceId: string): AmazonVariationLinks {
  const sets = item.relationships ?? [];
  const set = sets.find((entry) => entry.marketplaceId === marketplaceId) ?? sets[0];
  const variation = set?.relationships.filter((entry) => entry.type === 'VARIATION') ?? [];
  const parentSku = variation.flatMap((entry) => entry.parentSkus ?? [])[0] ?? null;
  const childSkus = [...new Set(variation.flatMap((entry) => entry.childSkus ?? []))].sort();
  const themeAttributes =
    variation.flatMap((entry) => entry.variationTheme?.attributes ?? [])
      .concat(themeFromAttribute(item, marketplaceId))
      .filter((value, index, all) => all.indexOf(value) === index);
  return { parentSku, childSkus, themeAttributes };
}

function themeFromAttribute(item: AmazonListingItem, marketplaceId: string): string[] {
  const theme = attributeValues(item, 'variation_theme', marketplaceId)[0]?.name;
  if (typeof theme !== 'string') {
    return [];
  }
  return theme
    .split('/')
    .map((part) => part.trim().toLowerCase().replace(/_name$/, ''))
    .filter((part) => part.length > 0);
}

export function listingPrice(item: AmazonListingItem, marketplaceId: string): number | null {
  for (const offer of attributeValues(item, 'purchasable_offer', marketplaceId)) {
    const ourPrice = offer.our_price;
    if (!Array.isArray(ourPrice)) continue;
    const schedule = (ourPrice[0] as { schedule?: Array<{ value_with_tax?: unknown }> } | undefined)?.schedule;
    const amount = schedule?.[0]?.value_with_tax;
    const number = typeof amount === 'number' ? amount : typeof amount === 'string' ? Number(amount) : NaN;
    if (Number.isFinite(number)) {
      return number;
    }
  }
  const offer = item.offers?.find((entry) => entry.marketplaceId === marketplaceId && entry.offerType === 'B2C');
  const fromOffer = offer ? Number(offer.price.amount) : NaN;
  return Number.isFinite(fromOffer) ? fromOffer : null;
}

export function listingEan(item: AmazonListingItem, marketplaceId: string): string | null {
  for (const value of attributeValues(item, 'externally_assigned_product_identifier', marketplaceId)) {
    if (typeof value.type === 'string' && /^(ean|gtin|upc)$/i.test(value.type) && typeof value.value === 'string') {
      return value.value.trim();
    }
  }
  return null;
}

/**
 * The listing's images: the seller's image attributes, else the main image of
 * the listing's summary. Amazon hosts that one and reports it even when the
 * seller's attributes carry no image locator.
 */
export function listingImages(item: AmazonListingItem, marketplaceId: string): string[] {
  const fromAttributes = attributeImages(item, marketplaceId);
  if (fromAttributes.length > 0) {
    return fromAttributes;
  }
  const summary = item.summaries?.find((entry) => entry.marketplaceId === marketplaceId) ?? item.summaries?.[0];
  const main = summary?.mainImage?.link;
  return typeof main === 'string' && main.startsWith('https://') ? [main] : [];
}

function attributeImages(item: AmazonListingItem, marketplaceId: string): string[] {
  const urls: string[] = [];
  const add = (name: string): void => {
    const location = attributeValues(item, name, marketplaceId)[0]?.media_location;
    if (typeof location === 'string' && location.startsWith('https://')) {
      urls.push(location);
    }
  };
  add('main_product_image_locator');
  for (let index = 1; index <= MAX_OTHER_IMAGES; index += 1) {
    add(`other_product_image_locator_${index}`);
  }
  return [...new Set(urls)];
}

export function listingWeightGrams(item: AmazonListingItem, marketplaceId: string): number | null {
  for (const name of ['item_package_weight', 'item_weight']) {
    const value = attributeValues(item, name, marketplaceId)[0];
    const amount = typeof value?.value === 'number' ? value.value : Number(value?.value);
    const unit = typeof value?.unit === 'string' ? GRAMS_PER_UNIT[value.unit.toLowerCase()] : undefined;
    if (Number.isFinite(amount) && unit !== undefined) {
      return Math.round(amount * unit);
    }
  }
  return null;
}

export function listingDescription(item: AmazonListingItem, marketplaceId: string): string | null {
  const bullets = attributeValues(item, 'bullet_point', marketplaceId)
    .map((value) => (typeof value.value === 'string' ? value.value.trim() : ''))
    .filter((text) => text.length > 0);
  const description = attributeText(item, 'product_description', marketplaceId);
  const parts = [
    ...(bullets.length > 0 ? [`<ul>${bullets.map((text) => `<li>${escapeHtml(text)}</li>`).join('')}</ul>`] : []),
    ...(description ? [description.includes('<') ? description : `<p>${escapeHtml(description)}</p>`] : []),
  ];
  return parts.length > 0 ? parts.join('') : null;
}

export interface AmazonProductContext {
  readonly marketplaceId: string;
  readonly currency: string;
  readonly catalog?: AmazonCatalogEntry | null;
}

export function mapAmazonProduct(item: AmazonListingItem, ctx: AmazonProductContext): Product {
  const summary = item.summaries?.find((entry) => entry.marketplaceId === ctx.marketplaceId) ?? item.summaries?.[0];
  const productType = summary?.productType ?? null;
  const images = listingImages(item, ctx.marketplaceId);
  const brand = attributeText(item, 'brand', ctx.marketplaceId) ?? ctx.catalog?.brand ?? null;
  const weightGrams = listingWeightGrams(item, ctx.marketplaceId);
  return {
    id: '',
    name: attributeText(item, 'item_name', ctx.marketplaceId) ?? summary?.itemName ?? ctx.catalog?.name ?? item.sku,
    sku: item.sku,
    price: listingPrice(item, ctx.marketplaceId),
    description: listingDescription(item, ctx.marketplaceId),
    images: images.length > 0 ? images : ctx.catalog?.images.length ? [...ctx.catalog.images] : null,
    currency: ctx.currency,
    ...(weightGrams !== null ? { weight: weightGrams / 1000 } : {}),
    ...(productType ? { categories: [productType], categoryBreadcrumb: [{ id: productType, name: productType }] } : {}),
    features: brand ? [{ name: 'Brand', value: brand }] : [],
  };
}

export function mapAmazonVariant(
  item: AmazonListingItem,
  productId: string,
  themeAttributes: readonly string[],
  ctx: AmazonProductContext,
): ProductVariant {
  const attributes: Record<string, string> = {};
  for (const name of themeAttributes) {
    const value = attributeText(item, name, ctx.marketplaceId);
    if (value !== null) {
      attributes[name] = value;
    }
  }
  const ean = listingEan(item, ctx.marketplaceId) ?? ctx.catalog?.ean ?? null;
  const price = listingPrice(item, ctx.marketplaceId);
  const images = listingImages(item, ctx.marketplaceId);
  const weightGrams = listingWeightGrams(item, ctx.marketplaceId);
  return {
    id: '',
    productId,
    sku: item.sku,
    attributes: Object.keys(attributes).length > 0 ? attributes : null,
    ean,
    gtin: ean,
    ...(price !== null ? { price } : {}),
    images: images.length > 0 ? images : null,
    weightGrams,
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
