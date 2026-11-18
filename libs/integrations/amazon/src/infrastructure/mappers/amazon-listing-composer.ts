/**
 * Amazon Listing Composer (#4181)
 *
 * Pure mapping from OpenLinker's `CreateOfferCommand` to the body of a
 * Listings Items `putListingsItem` call. Two shapes:
 *
 *   - **offer only** (`LISTING_OFFER_ONLY`): the product already exists in
 *     Amazon's catalogue under an ASIN; the body names the ASIN and carries the
 *     seller's condition, price and stock.
 *   - **full listing** (`LISTING`, #4181 part B): a new catalogue item under a
 *     product type, with title, brand, EAN, description, images and the
 *     projected product-type attributes, plus the same offer attributes.
 *
 * The listing is written to every configured marketplace that sells in the
 * command's currency (a EUR price lists on DE and FR, never on PL); a price no
 * configured marketplace sells in is refused rather than converted.
 *
 * The SKU is the seller's id for the listing and is OpenLinker's external
 * offer id: `platformParams.sku` when the operator gave one, otherwise one
 * derived from the internal variant id, so a retry of the same create
 * addresses the same listing.
 *
 * @module libs/integrations/amazon/src/infrastructure/mappers
 */
import type { CreateOfferCommand, OfferParameter } from '@openlinker/core/listings';

import { AMAZON_KNOWN_MARKETPLACES } from '../../amazon.constants';
import { AmazonNotSupportedException } from '../../domain/exceptions/amazon-not-supported.exception';
import { AMAZON_SELLER_FULFILLMENT_CHANNEL } from '../../domain/types/amazon-listing.types';

/** Amazon's SKU limit. */
export const AMAZON_SKU_MAX_LENGTH = 40;
/** The product type Amazon accepts for an offer on an existing ASIN when the item's own is unknown. */
export const AMAZON_OFFER_ONLY_PRODUCT_TYPE = 'PRODUCT';
/** At most one main and eight other images per listing. */
const MAX_OTHER_IMAGES = 8;

export type AmazonListingRequirements = 'LISTING' | 'LISTING_OFFER_ONLY';

export interface AmazonListingBody {
  readonly productType: string;
  readonly requirements: AmazonListingRequirements;
  readonly attributes: Record<string, unknown>;
}

export interface AmazonListingPlan {
  readonly sku: string;
  readonly marketplaceIds: readonly string[];
  readonly body: AmazonListingBody;
}

/** Derives the listing's SKU: the operator's, else `OL-` + the variant id without its prefix. */
export function resolveAmazonSku(cmd: CreateOfferCommand): string {
  const explicit = cmd.overrides?.platformParams?.['sku'];
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    const sku = explicit.trim();
    if (sku.length > AMAZON_SKU_MAX_LENGTH) {
      throw new AmazonNotSupportedException(`a SKU longer than ${AMAZON_SKU_MAX_LENGTH} characters (${sku})`);
    }
    return sku;
  }
  const base = cmd.internalVariantId.replace(/^ol_variant_/, '');
  return `OL-${base}`.slice(0, AMAZON_SKU_MAX_LENGTH);
}

/** The configured marketplaces that sell in the price's currency. */
export function marketplacesForCurrency(marketplaceIds: readonly string[], currency: string): string[] {
  const matching = marketplaceIds.filter((id) => AMAZON_KNOWN_MARKETPLACES[id]?.currency === currency);
  if (matching.length === 0) {
    throw new AmazonNotSupportedException(`a ${currency} price: no configured marketplace sells in ${currency}`);
  }
  return matching;
}

export function composeOfferOnlyListing(input: {
  readonly cmd: CreateOfferCommand;
  readonly asin: string;
  readonly productType: string | null;
  readonly marketplaceIds: readonly string[];
  /** The Amazon `product_tax_code` the catalogue rate maps to, when one does. */
  readonly taxCode?: string | null;
}): AmazonListingPlan {
  const marketplaces = marketplacesForCurrency(input.marketplaceIds, input.cmd.price.currency);
  return {
    sku: resolveAmazonSku(input.cmd),
    marketplaceIds: marketplaces,
    body: {
      productType: input.productType ?? AMAZON_OFFER_ONLY_PRODUCT_TYPE,
      requirements: 'LISTING_OFFER_ONLY',
      attributes: {
        merchant_suggested_asin: marketplaces.map((marketplace_id) => ({ value: input.asin, marketplace_id })),
        ...offerAttributes(input.cmd, marketplaces, input.taxCode ?? null),
      },
    },
  };
}

export interface AmazonFullListingContent {
  readonly title: string;
  readonly brand: string;
  readonly ean: string;
  readonly description: string | null;
  readonly imageUrls: readonly string[];
  readonly parameters: readonly OfferParameter[];
}

export function composeFullListing(input: {
  readonly cmd: CreateOfferCommand;
  readonly productType: string;
  readonly content: AmazonFullListingContent;
  readonly marketplaceIds: readonly string[];
  /** The Amazon `product_tax_code` the catalogue rate maps to, when one does. */
  readonly taxCode?: string | null;
}): AmazonListingPlan {
  const marketplaces = marketplacesForCurrency(input.marketplaceIds, input.cmd.price.currency);
  const { content } = input;
  const text = (value: string): Array<Record<string, string>> =>
    marketplaces.map((marketplace_id) => ({
      value,
      language_tag: AMAZON_KNOWN_MARKETPLACES[marketplace_id]?.languageTag ?? 'en_GB',
      marketplace_id,
    }));

  // Every marketplace the listing goes to needs its own copy of a required
  // attribute. A picked dictionary entry is the value Amazon expects as is; a
  // typed value is text, which Amazon reads in the marketplace's language.
  const attributes: Record<string, unknown> = {};
  for (const parameter of input.content.parameters) {
    const picked = parameter.valuesIds ?? [];
    const typed = picked.length > 0 ? [] : (parameter.values ?? []);
    if (picked.length === 0 && typed.length === 0) {
      continue;
    }
    attributes[parameter.id] = marketplaces.flatMap((marketplace_id) =>
      picked.length > 0
        ? picked.map((value) => ({ value, marketplace_id }))
        : typed.map((value) => ({
            value,
            language_tag: AMAZON_KNOWN_MARKETPLACES[marketplace_id]?.languageTag ?? 'en_GB',
            marketplace_id,
          })),
    );
  }

  Object.assign(attributes, {
    item_name: text(content.title),
    brand: text(content.brand),
    externally_assigned_product_identifier: marketplaces.map((marketplace_id) => ({
      type: 'ean',
      value: content.ean,
      marketplace_id,
    })),
    ...(content.description ? { product_description: text(stripHtml(content.description)) } : {}),
    ...imageAttributes(content.imageUrls, marketplaces),
    ...offerAttributes(input.cmd, marketplaces, input.taxCode ?? null),
  });

  return {
    sku: resolveAmazonSku(input.cmd),
    marketplaceIds: marketplaces,
    body: { productType: input.productType, requirements: 'LISTING', attributes },
  };
}

function offerAttributes(
  cmd: CreateOfferCommand,
  marketplaces: readonly string[],
  taxCode: string | null,
): Record<string, unknown> {
  const condition = cmd.condition === 'used' ? 'used_good' : 'new_new';
  return {
    ...(taxCode ? { product_tax_code: marketplaces.map((marketplace_id) => ({ value: taxCode, marketplace_id })) } : {}),
    condition_type: marketplaces.map((marketplace_id) => ({ value: condition, marketplace_id })),
    purchasable_offer: marketplaces.map((marketplace_id) => ({
      marketplace_id,
      currency: cmd.price.currency,
      our_price: [{ schedule: [{ value_with_tax: cmd.price.amount }] }],
    })),
    fulfillment_availability: [
      { fulfillment_channel_code: AMAZON_SELLER_FULFILLMENT_CHANNEL, quantity: Math.max(0, Math.floor(cmd.stock)) },
    ],
  };
}

function imageAttributes(urls: readonly string[], marketplaces: readonly string[]): Record<string, unknown> {
  const images = urls.filter((url) => /^https:\/\//.test(url));
  const locator = (url: string): Array<Record<string, string>> =>
    marketplaces.map((marketplace_id) => ({ media_location: url, marketplace_id }));
  const result: Record<string, unknown> = {};
  if (images[0] !== undefined) {
    result.main_product_image_locator = locator(images[0]);
  }
  images.slice(1, 1 + MAX_OTHER_IMAGES).forEach((url, index) => {
    result[`other_product_image_locator_${index + 1}`] = locator(url);
  });
  return result;
}

/** Amazon renders `product_description` as plain text with line breaks only. */
function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
