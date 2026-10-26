/**
 * WooCommerce Physical Data
 *
 * Pure conversion of WooCommerce weight and dimensions into the neutral
 * grams / millimetres OpenLinker persists on a variant (#3650). The store's
 * units (`woocommerce_weight_unit`, `woocommerce_dimension_unit`) are applied
 * here, in the integration package, never in `libs/core`.
 *
 * A variation's own value wins per field; an empty own value falls back to the
 * parent product's. An unknown unit or a non-positive / unparseable number
 * yields `null` ("not recorded"), never a guess.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers
 */
import type { WooCommerceDimensions } from '../adapters/product-master/woocommerce-product.types';

/** Store units as read from `GET /settings/products`. */
export interface WooCommerceStoreUnits {
  weightUnit: string | null;
  dimensionUnit: string | null;
}

/** Neutral physical data; `null` means "not recorded". */
export interface WooCommercePhysicalData {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}

/** The subset of a product / variation this module reads. */
export interface WooCommercePhysicalSource {
  weight?: string;
  dimensions?: WooCommerceDimensions;
}

const GRAMS_PER_UNIT: Readonly<Record<string, number>> = {
  g: 1,
  kg: 1000,
  lbs: 453.59237,
  lb: 453.59237,
  oz: 28.349523125,
};

const MM_PER_UNIT: Readonly<Record<string, number>> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  yd: 914.4,
};

/** A positive finite number from a WooCommerce string field, else `null`. */
function parsePositive(value: string | undefined): number | null {
  if (value === undefined || value === null || value.trim() === '') {
    return null;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function convert(
  raw: string | undefined,
  unit: string | null,
  table: Readonly<Record<string, number>>
): number | null {
  const factor = unit ? table[unit.trim().toLowerCase()] : undefined;
  const parsed = parsePositive(raw);
  if (factor === undefined || parsed === null) {
    return null;
  }
  const converted = Math.round(parsed * factor);
  return converted > 0 ? converted : null;
}

/** First field that is a usable positive number: own value, then parent's. */
function pick(own: string | undefined, parent: string | undefined): string | undefined {
  return parsePositive(own) !== null ? own : parent;
}

/**
 * Physical data for one variant. Pass `variation` for a variable product's
 * variation and omit it for a simple product's synthetic variant.
 */
export function buildWooCommercePhysicalData(
  parent: WooCommercePhysicalSource,
  variation: WooCommercePhysicalSource | undefined,
  units: WooCommerceStoreUnits | null
): WooCommercePhysicalData {
  if (!units) {
    return { weightGrams: null, lengthMm: null, widthMm: null, heightMm: null };
  }
  const own = variation ?? {};
  return {
    weightGrams: convert(pick(own.weight, parent.weight), units.weightUnit, GRAMS_PER_UNIT),
    lengthMm: convert(
      pick(own.dimensions?.length, parent.dimensions?.length),
      units.dimensionUnit,
      MM_PER_UNIT
    ),
    widthMm: convert(
      pick(own.dimensions?.width, parent.dimensions?.width),
      units.dimensionUnit,
      MM_PER_UNIT
    ),
    heightMm: convert(
      pick(own.dimensions?.height, parent.dimensions?.height),
      units.dimensionUnit,
      MM_PER_UNIT
    ),
  };
}
