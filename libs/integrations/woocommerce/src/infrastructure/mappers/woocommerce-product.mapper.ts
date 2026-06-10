/**
 * WooCommerce Product Mapper
 *
 * Maps WooCommerce REST API v3 product and variation payloads to the
 * OpenLinker unified Product and ProductVariant domain entities.
 *
 * Description is stored as raw HTML — no stripping. This matches the
 * PrestaShop pattern; outbound adapters (e.g. Allegro) sanitise on publish
 * via sanitizeAllegroDescription.
 *
 * Price parsing uses Number.isFinite to correctly preserve zero-price
 * products (free downloads, giveaways) — `parseFloat('0') || null` would
 * incorrectly discard them.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 * @implements {IWooCommerceProductMapper}
 */
import type { Product, ProductVariant } from '@openlinker/core/products';
import { normalizeToEan13, normalizeBarcode } from '@openlinker/core/products';
import type { IWooCommerceProductMapper } from './woocommerce-product.mapper.interface';
import type { WooCommerceProductMapperOptions } from './woocommerce-product.mapper.types';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
  WooCommerceMetaEntry,
} from '../adapters/product-master/woocommerce-product.types';

// WooCommerce has no canonical barcode field — plugins/themes store it under
// many meta_data keys. EAN and GTIN deliberately share several candidate keys
// (`_ean`/`ean`/`_gtin`/`gtin`/`_barcode`) because the same raw value is a
// valid EAN-13 *and* a GTIN. The key arrays differ only in lookup PRIORITY:
// EAN tries EAN-named keys first (then GTIN/barcode as fallback), GTIN tries
// GTIN-named keys first. The two fields are then normalised differently
// (normalizeToEan13 vs normalizeBarcode), so the overlap is intentional, not a
// copy-paste bug.
const EAN_KEYS = ['_ean', 'ean', '_gtin', 'gtin', '_barcode', 'barcode'] as const;
const GTIN_KEYS = ['_gtin', 'gtin', '_ean', 'ean', '_wc_gtin', 'hwp_product_gtin', '_barcode'] as const;

export class WooCommerceProductMapper implements IWooCommerceProductMapper {
  constructor(private readonly options: WooCommerceProductMapperOptions) {}

  mapProduct(p: WooCommerceProduct): Omit<Product, 'id'> {
    return {
      name: p.name ?? '',
      sku: p.sku || null,
      price: this.parsePrice(p.price) ?? null,
      currency: this.options.currency ?? null,
      description: p.description || null,
      images: p.images?.map((i) => i.src) ?? null,
      categories: p.categories?.map((c) => String(c.id)) ?? [],
      weight: this.parseOptionalNumber(p.weight),
      createdAt: p.date_created ? new Date(p.date_created) : undefined,
      updatedAt: p.date_modified ? new Date(p.date_modified) : undefined,
    };
  }

  mapVariation(v: WooCommerceProductVariation, productId: string): Omit<ProductVariant, 'id'> {
    const attrs = v.attributes ?? [];
    const attributeRecord: Record<string, string> = {};
    for (const a of attrs) {
      attributeRecord[a.name] = a.option;
    }

    const metaData = v.meta_data ?? [];

    return {
      productId,
      sku: v.sku || null,
      price: this.parsePrice(v.price) ?? undefined,
      weight: this.parseOptionalNumber(v.weight),
      attributes: Object.keys(attributeRecord).length > 0 ? attributeRecord : null,
      ean: normalizeToEan13(this.extractMeta(metaData, ...EAN_KEYS)),
      gtin: normalizeBarcode(this.extractMeta(metaData, ...GTIN_KEYS)),
      createdAt: v.date_created ? new Date(v.date_created) : undefined,
      updatedAt: v.date_modified ? new Date(v.date_modified) : undefined,
    };
  }

  /** Returns the numeric value (including 0) or null. Used for price fields. */
  private parsePrice(value?: string): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }

  /** Returns the numeric value (including 0) or undefined. Used for weight fields. */
  private parseOptionalNumber(value?: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }

  extractEan(metaData: WooCommerceMetaEntry[]): string | null {
    return normalizeToEan13(this.extractMeta(metaData, ...EAN_KEYS));
  }

  extractGtin(metaData: WooCommerceMetaEntry[]): string | null {
    return normalizeBarcode(this.extractMeta(metaData, ...GTIN_KEYS));
  }

  private extractMeta(metaData: WooCommerceMetaEntry[], ...keys: string[]): string | null {
    for (const key of keys) {
      const entry = metaData.find((m) => m.key === key);
      if (typeof entry?.value === 'string' && entry.value.trim().length > 0) {
        return entry.value.trim();
      }
    }
    return null;
  }
}
