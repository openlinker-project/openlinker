/**
 * Build Projection Metadata
 *
 * Pure helper (#1841): assemble the product-derived {@link AttributeProjectionMetadata}
 * that `place-value` attribute mapping rules read from (and that manufacturer /
 * phrase rule-scoping matches against). Shared by the offer-builder and
 * product-publish-builder call sites so both feed projection identically.
 *
 * Manufacturer has no first-class product field; it is derived from a product
 * feature whose name matches a small set of well-known keys
 * (manufacturer / brand / marka / producent), case-insensitively.
 *
 * @module libs/core/src/listings/application/services
 */

import type { Product, ProductVariant } from '@openlinker/core/products';
import type { AttributeProjectionMetadata } from '../types/attribute-projection.types';

const MANUFACTURER_FEATURE_KEYS = ['manufacturer', 'brand', 'marka', 'producent'];

export function buildProjectionMetadata(
  product: Product,
  variant: ProductVariant,
  barcode: string | null
): AttributeProjectionMetadata {
  const metadata: AttributeProjectionMetadata = {};

  if (product.name) metadata.productName = product.name;

  const variantName = Object.values(variant.attributes ?? {})
    .filter((v) => v != null && v !== '')
    .join(' / ');
  if (variantName) metadata.variantName = variantName;

  const manufacturer = resolveManufacturer(product);
  if (manufacturer) metadata.manufacturer = manufacturer;

  const ean = barcode ?? variant.ean ?? variant.gtin ?? null;
  if (ean) metadata.ean = ean;

  const sku = variant.sku ?? product.sku ?? null;
  if (sku) metadata.sku = sku;

  const weight = variant.weight ?? product.weight;
  if (weight != null) metadata.weight = String(weight);

  return metadata;
}

function resolveManufacturer(product: Product): string | undefined {
  const feature = (product.features ?? []).find((f) =>
    MANUFACTURER_FEATURE_KEYS.includes(f.name.trim().toLowerCase())
  );
  return feature && feature.value !== '' ? feature.value : undefined;
}
