/**
 * Shoper Product Mapper
 *
 * Pure functions mapping Shoper payloads onto the neutral `Product` /
 * `ProductVariant`. No I/O and no identifier mapping: the adapter swaps
 * Shoper's ids for internal ones around these calls, so the results omit `id`.
 *
 * Shoper serializes nearly every number as a string and sends empty text as
 * `""` or `null`; both are normalised here so the neutral model never sees
 * `""` standing in for "absent" (an empty EAN must not reach core as a value).
 *
 * Two deliberate omissions:
 *   - `createdAt` / `updatedAt`: Shoper sends zone-less local timestamps
 *     (`2025-09-13 09:57:48`) and parsing them with the process time zone would
 *     stamp a wrong instant. Absent is honest; the fields are optional.
 *   - variant `attributes` are never guessed: they come from a stock's `options`
 *     (ids only, names resolved by the adapter through `/options` and
 *     `/option-values`) and a variant whose options cannot ALL be resolved gets
 *     `null` rather than a partial set.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { Product, ProductVariant } from '@openlinker/core/products';

import type {
  ShoperMainImage,
  ShoperProduct,
  ShoperProductTranslation,
  ShoperStock,
  ShoperStockOptions,
} from '../../domain/types/shoper-api.types';
import type { ShoperOptionEntry } from '../shop-context/shoper-option-table.provider';

/** What the mapper needs to know about the shop beyond the payload itself. */
export interface ShoperMapContext {
  /** Normalised shop host, used to build public image URLs. */
  readonly host: string;
  /** Shop default language, e.g. `pl_PL` (`application-config.default_language_name`). */
  readonly language: string;
  /** Shop default currency, e.g. `PLN`. Null when the shop did not report one. */
  readonly currency: string | null;
  /** Shop weight unit (`application-config.locale_default_weight`). */
  readonly weightUnit: string;
  /**
   * Whether the shop runs the multi-warehouse module (`warehouses_enabled`).
   * With it on, `product-stocks.stock` is no longer known to be the whole pool,
   * so stock reads and writes refuse instead of reporting a wrong total.
   */
  readonly warehousesEnabled: boolean;
  /**
   * Whether Shoper itself removes stock when an order line is created
   * (`shopping_update_stock_on_buy`). OpenLinker never writes stock on account of
   * an order it created, so this only decides whether a warning is due: when it
   * is off, an order created here leaves the shop's stock unchanged.
   */
  readonly decrementsStockOnOrder: boolean;
  /**
   * IANA zone of the shop's naive order timestamps (`application-config.locale_timezone`).
   * Optional: an entry cached by an earlier release lacks it, and the order source
   * then reads timestamps as UTC rather than guess a zone.
   */
  readonly timezone?: string | null;
}

const KILOGRAM = 'KILOGRAM';

/** Parses Shoper's numeric strings. Returns undefined for absent / non-numeric, keeps 0. */
export function parseShoperNumber(raw: string | number | null | undefined): number | undefined {
  if (raw === null || raw === undefined || raw === '') {
    return undefined;
  }
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function nonEmpty(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Picks the translation to read text from: the shop's default language, else
 * the first translation that has a name. `isdefault` is not used - it reads
 * `"0"` on every language of a live shop.
 */
export function pickShoperTranslation(
  translations: Readonly<Record<string, ShoperProductTranslation>> | undefined,
  language: string,
): ShoperProductTranslation | undefined {
  if (translations === undefined) {
    return undefined;
  }
  const preferred = translations[language];
  if (preferred !== undefined && nonEmpty(preferred.name) !== null) {
    return preferred;
  }
  return Object.values(translations).find((t) => nonEmpty(t.name) !== null);
}

/** A file stem: word characters, dots and dashes, never a leading dot (no `..`). */
const IMAGE_STEM = /^\w[\w.-]*$/;
const IMAGE_EXTENSION = /^\w+$/;

/**
 * Public URL of a gfx. Verified live: `/userdata/public/gfx/<unic_name>.<extension>`.
 *
 * `unic_name` and `extension` come from the shop and are interpolated into a
 * path, so a `/`, `?`, `#` or `..` would change which resource is addressed.
 * The host is fixed, so this is not SSRF, but a value that is not a plain file
 * name yields `null` (no image) rather than a URL pointing somewhere else.
 */
export function buildShoperImageUrl(host: string, image: ShoperMainImage): string | null {
  if (!IMAGE_STEM.test(image.unic_name) || !IMAGE_EXTENSION.test(image.extension)) {
    return null;
  }
  return `https://${host}/userdata/public/gfx/${image.unic_name}.${image.extension}`;
}

function weightInKilograms(raw: string | null, unit: string): number | undefined {
  // Only kilograms are converted with confidence; any other unit is left unset
  // rather than reported in the wrong magnitude.
  return unit === KILOGRAM ? parseShoperNumber(raw) : undefined;
}

export function mapShoperStockToVariant(
  stock: ShoperStock,
  productId: string,
  ctx: ShoperMapContext,
  attributes: Record<string, string> | null = null,
): Omit<ProductVariant, 'id'> {
  const ean = nonEmpty(stock.ean);
  const weight = weightInKilograms(stock.weight, ctx.weightUnit);
  const price = parseShoperNumber(stock.price);

  return {
    productId,
    sku: nonEmpty(stock.code),
    attributes,
    ean,
    gtin: ean,
    ...(price === undefined ? {} : { price }),
    ...(weight === undefined ? {} : { weight, weightGrams: Math.round(weight * 1000) }),
  };
}

export function mapShoperProduct(raw: ShoperProduct, ctx: ShoperMapContext): Omit<Product, 'id'> {
  const translation = pickShoperTranslation(raw.translations, ctx.language);
  const sku = nonEmpty(raw.code);
  const weight =
    raw.stock === null ? undefined : weightInKilograms(raw.stock.weight, ctx.weightUnit);
  const imageUrl = raw.main_image === null ? null : buildShoperImageUrl(ctx.host, raw.main_image);

  return {
    name: nonEmpty(translation?.name) ?? sku ?? `product-${raw.product_id}`,
    sku,
    price: raw.stock === null ? null : (parseShoperNumber(raw.stock.price) ?? null),
    description: nonEmpty(translation?.description),
    images: imageUrl === null ? null : [imageUrl],
    currency: ctx.currency,
    categories: raw.categories.map(String),
    ...(weight === undefined ? {} : { weight }),
  };
}

const SHOPER_ID_PATTERN = /^\d+$/;

/**
 * The `[option_id, ovalue_id]` pairs of a stock's `options`, or `'malformed'`
 * when the value is not the verified `{ "<id>": "<id>" }` object. A stock with no
 * options is `[]` (an empty array on the wire, an empty object tolerated) and has
 * no pairs - that is a simple variant, not a malformed one.
 */
export function shoperStockOptionPairs(
  options: ShoperStockOptions | null | undefined,
): ReadonlyArray<readonly [string, string]> | 'malformed' {
  if (options === null || options === undefined) {
    return [];
  }
  if (Array.isArray(options)) {
    return options.length === 0 ? [] : 'malformed';
  }
  if (typeof options !== 'object') {
    return 'malformed';
  }
  const pairs: Array<readonly [string, string]> = [];
  for (const [optionId, valueId] of Object.entries(options)) {
    if (!SHOPER_ID_PATTERN.test(optionId) || typeof valueId !== 'string' || !SHOPER_ID_PATTERN.test(valueId)) {
      return 'malformed';
    }
    pairs.push([optionId, valueId]);
  }
  return pairs;
}

export interface ShoperVariantAttributesResult {
  /** Option name -> value text, or `null` when there is nothing to report or it cannot be reported whole. */
  readonly attributes: Record<string, string> | null;
  /** Why a stock that HAS options got no attributes; absent for a simple variant. */
  readonly problem?: string;
}

function translatedText(
  translations: Readonly<Record<string, Record<string, string | null | undefined>>>,
  field: string,
  language: string,
): string | null {
  const preferred = nonEmpty(translations[language]?.[field]);
  if (preferred !== null) {
    return preferred;
  }
  for (const translation of Object.values(translations)) {
    const text = nonEmpty(translation[field]);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

/**
 * Option name -> value text for one stock, in the shop language.
 *
 * ALL or nothing: one option that cannot be resolved (unknown option or value, no
 * name or text in any language, two options sharing a name) gives `null` and a
 * reason, never a partial set - a sibling grouped on half its attributes would
 * look distinguished while still colliding. Nothing is guessed from the ids.
 */
export function resolveShoperVariantAttributes(
  options: ShoperStockOptions | null | undefined,
  entries: ReadonlyMap<string, ShoperOptionEntry | null>,
  language: string,
): ShoperVariantAttributesResult {
  const pairs = shoperStockOptionPairs(options);
  if (pairs === 'malformed') {
    return { attributes: null, problem: 'its options are not an { option_id: value_id } object' };
  }
  if (pairs.length === 0) {
    return { attributes: null };
  }

  const attributes: Record<string, string> = {};
  for (const [optionId, valueId] of pairs) {
    const entry = entries.get(optionId);
    if (entry === undefined || entry === null) {
      return { attributes: null, problem: `option ${optionId} could not be read from the shop` };
    }
    const value = entry.values.get(valueId);
    if (value === undefined) {
      return { attributes: null, problem: `option ${optionId} has no value ${valueId}` };
    }
    const name = translatedText(entry.option.translations, 'name', language);
    const text = translatedText(value.translations, 'value', language);
    if (name === null || text === null) {
      return { attributes: null, problem: `option ${optionId} / value ${valueId} has no readable name or text` };
    }
    if (name in attributes) {
      return { attributes: null, problem: `two options are both named "${name}"` };
    }
    attributes[name] = text;
  }
  return { attributes };
}
