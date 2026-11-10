/**
 * Shopify Product Publish Mapper
 *
 * Pure builders from a neutral `PublishProductCommand` to the Admin GraphQL
 * inputs the ProductPublisher sends (`productSet`,
 * `productVariantsBulkCreate` / `Update`), plus the warnings for every command
 * field Shopify is not given. No I/O.
 *
 * Shapes that matter:
 *   - prices arrive GROSS (ADR-077). A shop entering prices with tax gets
 *     them as they are; a shop entering prices without tax gets them net,
 *     divided by the catalogue's own rate (`resolvePublishPriceBasis`), the
 *     WooCommerce shape. An exemption code is published as is, not taxable;
 *   - a sale price becomes Shopify's `price`, the regular price its
 *     `compareAtPrice`. A scheduled sale cannot be expressed, so it is not
 *     applied at all rather than applied early;
 *   - a simple product is one variant on Shopify's default option
 *     (`Title` / `Default Title`).
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/product-publisher
 */
import { createHash } from 'node:crypto';

import type { PublishProductCommand } from '@openlinker/core/listings';

export const DEFAULT_OPTION_NAME = 'Title';
export const DEFAULT_OPTION_VALUE = 'Default Title';

/** Shopify allows 250 images per product; a publish sends at most this many, the first ones the master lists. */
const MAX_IMAGES_PER_PUBLISH = 20;

export interface OptionValueRef {
  readonly optionName: string;
  readonly name: string;
}

export interface PriceFields {
  readonly price: string;
  readonly compareAtPrice: string | null;
}

export interface ImagePlan {
  readonly urls: readonly string[];
  readonly warnings: readonly string[];
}

/** How a gross price becomes the amount the shop stores. */
export type ShopifyPriceBasis =
  | { readonly ok: true; readonly divisor: number; readonly exempt: boolean }
  | { readonly ok: false; readonly message: string };

const NUMERIC_RATE = /^\d+(\.\d+)?$/;

/**
 * The divisor that turns a gross price into the shop's own: 1 on a shop that
 * enters prices with tax, `1 + rate` on one that enters them without. The
 * rate is the catalogue's (`cmd.taxRate`); an exemption code (`zw`, `np`, ...)
 * or 0 publishes the price unchanged and marks the variant not taxable, and a
 * missing rate is refused rather than guessed, as the command contract asks.
 */
export function resolvePublishPriceBasis(taxesIncluded: boolean, taxRate: string | undefined): ShopifyPriceBasis {
  if (taxesIncluded) {
    return { ok: true, divisor: 1, exempt: false };
  }
  const code = taxRate?.trim().toLowerCase();
  if (code === undefined || code.length === 0) {
    return {
      ok: false,
      message:
        'The Shopify shop enters prices without tax and the catalogue holds no VAT rate for this product, ' +
        'so the net price cannot be worked out. Set the rate in the master shop or turn on ' +
        '"All prices include tax" in Shopify.',
    };
  }
  if (!NUMERIC_RATE.test(code)) {
    return { ok: true, divisor: 1, exempt: true };
  }
  const rate = Number(code);
  return { ok: true, divisor: 1 + rate / 100, exempt: rate === 0 };
}

function money(amount: number): string {
  return amount.toFixed(2);
}

/** A gross amount as the shop stores it, rounded to the cent. */
function storeAmount(gross: number, divisor: number): string {
  return money(Math.round((gross / divisor + Number.EPSILON) * 100) / 100);
}

/** Price + compare-at price, and a warning when a sale price had to be left out. */
export function buildPriceFields(
  cmd: PublishProductCommand,
  divisor = 1,
): { fields: PriceFields; warnings: string[] } {
  const regular = storeAmount(cmd.price.amount, divisor);
  const sale = cmd.commerce?.salePrice;
  if (sale === undefined) {
    return { fields: { price: regular, compareAtPrice: null }, warnings: [] };
  }
  if (cmd.commerce?.saleStartsAt !== undefined || cmd.commerce?.saleEndsAt !== undefined) {
    return {
      fields: { price: regular, compareAtPrice: null },
      warnings: [
        'The sale price was not applied: Shopify cannot schedule a sale, so the regular price was published.',
      ],
    };
  }
  if (sale.currency.toUpperCase() !== cmd.price.currency.toUpperCase() || sale.amount >= cmd.price.amount) {
    return {
      fields: { price: regular, compareAtPrice: null },
      warnings: ['The sale price was not applied: it is not lower than the price, or is in another currency.'],
    };
  }
  return { fields: { price: storeAmount(sale.amount, divisor), compareAtPrice: regular }, warnings: [] };
}

/**
 * `taxable` for a variant, or undefined to leave Shopify's value as it is. An
 * explicit tax status wins; otherwise an exempt catalogue rate on a shop that
 * adds tax on top makes the variant not taxable, or Shopify would tax it.
 */
export function taxableOf(cmd: PublishProductCommand, exempt = false): boolean | undefined {
  switch (cmd.commerce?.taxStatus) {
    case 'taxable':
      return true;
    case 'none':
      return false;
    default:
      return exempt ? false : undefined;
  }
}

/** The `inventoryItem` input shared by productSet and the bulk variant mutations. */
export function buildInventoryItemInput(cmd: PublishProductCommand): Record<string, unknown> {
  const sku = cmd.sku?.trim();
  return {
    tracked: true,
    ...(sku !== undefined && sku.length > 0 ? { sku } : {}),
    ...(cmd.weight !== undefined && cmd.weight > 0
      ? { measurement: { weight: { value: cmd.weight, unit: 'KILOGRAMS' } } }
      : {}),
  };
}

/** Variant fields common to every variant write (no id, no option values, no stock). */
export function buildVariantCoreFields(
  cmd: PublishProductCommand,
  price: PriceFields,
  exempt = false,
): Record<string, unknown> {
  const barcode = cmd.barcode?.trim();
  const taxable = taxableOf(cmd, exempt);
  return {
    price: price.price,
    compareAtPrice: price.compareAtPrice,
    ...(barcode !== undefined && barcode.length > 0 ? { barcode } : {}),
    ...(taxable === undefined ? {} : { taxable }),
    inventoryItem: buildInventoryItemInput(cmd),
  };
}

/**
 * Product-level fields of a `productSet` input. `productSet` behaves as PATCH
 * (SPIKE-2879 E-P5), so a field the command does not carry is simply omitted
 * and Shopify keeps its value.
 */
export function buildProductFields(cmd: PublishProductCommand): Record<string, unknown> {
  const content = cmd.content;
  const title = content?.title?.trim();
  const seoTitle = content?.seo?.title?.trim();
  const seoDescription = content?.seo?.description?.trim();
  const slug = content?.seo?.slug?.trim();
  const seo = {
    ...(seoTitle !== undefined && seoTitle.length > 0 ? { title: seoTitle } : {}),
    ...(seoDescription !== undefined && seoDescription.length > 0 ? { description: seoDescription } : {}),
  };
  return {
    status: cmd.status === 'published' ? 'ACTIVE' : 'DRAFT',
    ...(title !== undefined && title.length > 0 ? { title } : {}),
    ...(content?.description !== undefined && content.description !== null
      ? { descriptionHtml: content.description }
      : {}),
    ...(content?.tags !== undefined && content.tags !== null ? { tags: [...content.tags] } : {}),
    ...(Object.keys(seo).length > 0 ? { seo } : {}),
    ...(slug !== undefined && slug.length > 0 ? { handle: slug } : {}),
  };
}

/** `files` input for productSet: Shopify downloads every `originalSource` itself. */
export function buildFilesInput(urls: readonly string[], alt: string | undefined): Record<string, unknown>[] {
  return urls.map((url) => ({
    originalSource: url,
    contentType: 'IMAGE',
    ...(alt !== undefined && alt.length > 0 ? { alt } : {}),
  }));
}

/**
 * A host Shopify's servers cannot reach: a bare docker service name, localhost,
 * a private or link-local address, or an internal-only TLD.
 */
export function isUnreachableFromShopify(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || host === 'localhost') {
    return true;
  }
  if (/\.(local|internal|localhost|lan|home|docker)$/.test(host)) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4 !== null) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return host.startsWith('[');
}

/** The image URLs to send, de-duplicated, with a warning for each one left out. */
export function planImages(cmd: PublishProductCommand): ImagePlan {
  const urls: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const raw of cmd.content?.imageUrls ?? []) {
    const value = raw.trim();
    if (value.length === 0 || seen.has(value)) {
      continue;
    }
    seen.add(value);
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      warnings.push(`An image URL is not an absolute address and was not sent: ${value}`);
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      warnings.push(`An image URL is not http(s) and was not sent: ${value}`);
    } else if (isUnreachableFromShopify(parsed)) {
      warnings.push(
        `The image ${value} is on a host Shopify cannot reach (${parsed.hostname}), so it was not sent. ` +
          'Expose the master shop on a public address for images to reach Shopify.',
      );
    } else if (urls.length >= MAX_IMAGES_PER_PUBLISH) {
      warnings.push(`Only the first ${MAX_IMAGES_PER_PUBLISH} images are sent; ${value} was not.`);
    } else {
      urls.push(value);
    }
  }
  return { urls, warnings };
}

/** One warning per command field this adapter does not send to Shopify. */
export function unsupportedFieldWarnings(cmd: PublishProductCommand): string[] {
  const warnings: string[] = [];
  const shortDescription = cmd.content?.shortDescription;
  if (shortDescription !== undefined && shortDescription !== null && shortDescription.trim().length > 0) {
    warnings.push('The short description was not sent: Shopify products have no short description field.');
  }
  const dimensions = cmd.commerce?.dimensions;
  if (dimensions !== undefined && Object.values(dimensions).some((v) => v !== undefined)) {
    warnings.push('Dimensions were not sent: Shopify variants carry a weight only.');
  }
  if (cmd.commerce?.taxClass !== undefined) {
    warnings.push('The tax class was not sent: Shopify has no tax classes on a product.');
  }
  if (cmd.commerce?.taxStatus === 'shipping') {
    warnings.push('The "shipping only" tax status was not sent: Shopify variants are taxable or not.');
  }
  if (cmd.platformParams !== undefined && Object.keys(cmd.platformParams).length > 0) {
    warnings.push(`Platform parameters were ignored: ${Object.keys(cmd.platformParams).join(', ')}.`);
  }
  if ((cmd.variantGroup?.imageUrls?.length ?? 0) > 0) {
    warnings.push("The variant's own image was not attached to it: the images went to the product gallery only.");
  }
  return warnings;
}

/**
 * A Shopify handle from free text: lowercase ASCII letters, digits and single
 * hyphens. Polish letters are folded to their base letter.
 */
export function toShopifyHandle(text: string): string {
  return text
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Shopify caps a handle at 255 characters; the readable part is kept short so the suffix always fits. */
const GROUP_HANDLE_BASE_MAX = 60;

/**
 * The handle of a variant group's Shopify product, the same for every sibling:
 * the readable name plus 8 hex characters of a hash of the group id, so no
 * product the operator made by hand can hold it. Shopify does not serialise
 * concurrent creates by handle (it suffixes `-1`, `-2`, measured live), so this
 * is not a lock; it makes the products a race produced findable by direct
 * reads (`<handle>`, `<handle>-1`, ...).
 */
export function groupHandle(cmd: PublishProductCommand, groupId: string): string {
  const readable = toShopifyHandle(cmd.content?.seo?.slug?.trim() || cmd.content?.title?.trim() || 'product')
    .slice(0, GROUP_HANDLE_BASE_MAX)
    .replace(/-+$/g, '');
  const tag = createHash('sha1').update(groupId).digest('hex').slice(0, 8);
  return `${readable.length > 0 ? readable : 'product'}-ol${tag}`;
}
