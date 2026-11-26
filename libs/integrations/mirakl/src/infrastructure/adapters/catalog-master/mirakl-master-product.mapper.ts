/**
 * Mirakl Master Product Mapper
 *
 * OF21 offer -> OpenLinker product and its one variant (#4284). A Mirakl offer
 * has no variants, so each offer is a product with a single variant, both keyed
 * by `shop_sku`.
 *
 * What is deliberately left out:
 * - images that are not on the card: OF21 carries no media, so the caller
 *   passes the card's pictures read from P11 (`mirakl-product-media-reader.ts`);
 *   a card without a picture (most Empik book cards) gives `null`, never an
 *   invented url;
 * - tax rate: an offer carries no VAT rate, so it stays unreported;
 * - GPSR: not on the offer, left `undefined` ("not reported"), never `null`
 *   ("asserted none");
 * - a description that is only the card page's CSS, which some Empik cards
 *   return instead of text (`mirakl-offer-description.policy.ts`).
 *
 * The price is the offer's gross price (ADR-077): Mirakl offer prices include
 * VAT.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import type { Category, Product, ProductVariant } from '@openlinker/core/products';
import { readMiraklOfferDescription } from '../../../domain/policies/mirakl-offer-description.policy';
import { pickMiraklBarcode } from '../../../domain/policies/mirakl-offer-reference.policy';
import type { MiraklOffer } from '../../../domain/types/mirakl-offer.types';

/** Name of the feature that carries the offer's brand. */
export const MIRAKL_BRAND_FEATURE = 'Brand';

/** The offer as a product, under the given internal id, with its card's pictures. */
export function mapMiraklOfferToProduct(
  offer: MiraklOffer,
  internalId: string,
  images: readonly string[] = []
): Product {
  const sku = offer.shop_sku ?? null;
  const category = mapMiraklOfferCategory(offer);
  const brand = nonBlank(offer.product_brand);
  return {
    id: internalId,
    name: nonBlank(offer.product_title) ?? sku ?? internalId,
    sku,
    price: readPrice(offer.price),
    description: readMiraklOfferDescription(offer.product_description),
    images: images.length > 0 ? [...images] : null,
    currency: nonBlank(offer.currency_iso_code),
    ...(category
      ? {
          categories: [category.id],
          categoryBreadcrumb: [{ id: category.id, name: category.name }],
        }
      : {}),
    ...(brand ? { features: [{ name: MIRAKL_BRAND_FEATURE, value: brand }] } : {}),
  };
}

/** The offer's single variant, under the given internal ids. */
export function mapMiraklOfferToVariant(
  offer: MiraklOffer,
  internalProductId: string,
  internalVariantId: string
): ProductVariant {
  const ean = pickMiraklBarcode(offer.product_references);
  const price = readPrice(offer.price);
  return {
    id: internalVariantId,
    productId: internalProductId,
    sku: offer.shop_sku ?? null,
    attributes: null,
    ean,
    gtin: ean,
    ...(price !== null ? { price } : {}),
  };
}

/** The offer's leaf category, when it names one. */
export function mapMiraklOfferCategory(offer: MiraklOffer): Category | null {
  const id = nonBlank(offer.category_code);
  if (!id) {
    return null;
  }
  return { id, name: nonBlank(offer.category_label) ?? id };
}

function readPrice(price: number | undefined): number | null {
  return typeof price === 'number' && Number.isFinite(price) && price >= 0 ? price : null;
}

function nonBlank(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
