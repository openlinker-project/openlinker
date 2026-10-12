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
 *   - variant `attributes`: the shape of a variant's `options` is not
 *     live-verified (the trial shop has no multi-variant product), so it is not
 *     guessed at; see the implementation plan's stated gaps.
 *
 * @module libs/integrations/shoper/src/infrastructure/mappers
 */
import type { Product, ProductVariant } from '@openlinker/core/products';

import type {
  ShoperMainImage,
  ShoperProduct,
  ShoperProductTranslation,
  ShoperStock,
} from '../../domain/types/shoper-api.types';

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
): Omit<ProductVariant, 'id'> {
  const ean = nonEmpty(stock.ean);
  const weight = weightInKilograms(stock.weight, ctx.weightUnit);
  const price = parseShoperNumber(stock.price);

  return {
    productId,
    sku: nonEmpty(stock.code),
    attributes: null,
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
