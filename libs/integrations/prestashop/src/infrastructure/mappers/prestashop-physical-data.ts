/**
 * PrestaShop Physical Data
 *
 * Pure conversion of PrestaShop weight and dimensions into the neutral grams /
 * millimetres OpenLinker persists on a variant (#3650). PrestaShop stores these
 * in shop-configured units (`PS_WEIGHT_UNIT`, `PS_DIMENSION_UNIT`), so the
 * unit tables live here, in the integration package, and never in `libs/core`.
 *
 * Two PrestaShop facts shape the rules:
 * - a combination's `weight` is an IMPACT added to the product weight, not an
 *   absolute value, so a variant weighs `product + combination`;
 * - width/height/depth are product-level (combinations carry none), so every
 *   combination inherits them.
 *
 * An unknown unit or a non-positive / unparseable number yields `null`
 * ("not recorded"), never a guess.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers
 */

/** Shop units as read from `PS_WEIGHT_UNIT` / `PS_DIMENSION_UNIT`. */
export interface PrestashopShopUnits {
  weightUnit: string | null;
  dimensionUnit: string | null;
}

/** Neutral physical data; `null` means "not recorded". */
export interface PrestashopPhysicalData {
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
}

const GRAMS_PER_UNIT: Readonly<Record<string, number>> = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  lbs: 453.59237,
  oz: 28.349523125,
};

const MM_PER_UNIT: Readonly<Record<string, number>> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

/** A finite number from a PrestaShop string/number field, else `null`. */
function parseFinite(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveInt(value: number | null, factor: number | undefined): number | null {
  if (value === null || factor === undefined) {
    return null;
  }
  const converted = Math.round(value * factor);
  return converted > 0 ? converted : null;
}

/**
 * Product weight plus optional combination impact, converted to grams.
 *
 * An absent product weight is read as 0, so a combination's weight impact on a
 * product with no base weight becomes the absolute weight. That is what
 * PrestaShop itself ships with, and it is the one place this arithmetic
 * asserts something the shop did not state outright.
 */
export function convertPrestashopWeightToGrams(
  productWeight: unknown,
  combinationImpact: unknown,
  weightUnit: string | null
): number | null {
  const factor = weightUnit ? GRAMS_PER_UNIT[weightUnit.trim().toLowerCase()] : undefined;
  const base = parseFinite(productWeight) ?? 0;
  const impact = parseFinite(combinationImpact) ?? 0;
  return toPositiveInt(base + impact, factor);
}

/** One product-level dimension converted to millimetres. */
export function convertPrestashopDimensionToMm(
  value: unknown,
  dimensionUnit: string | null
): number | null {
  const factor = dimensionUnit ? MM_PER_UNIT[dimensionUnit.trim().toLowerCase()] : undefined;
  return toPositiveInt(parseFinite(value), factor);
}

/**
 * Physical data for one variant. `combinationImpact` is undefined for a simple
 * product's synthetic variant. PrestaShop's `depth` is the length.
 */
export function buildPrestashopPhysicalData(
  product: { weight?: unknown; width?: unknown; height?: unknown; depth?: unknown },
  combinationImpact: unknown,
  units: PrestashopShopUnits | null
): PrestashopPhysicalData {
  if (!units) {
    return { weightGrams: null, lengthMm: null, widthMm: null, heightMm: null };
  }
  return {
    weightGrams: convertPrestashopWeightToGrams(product.weight, combinationImpact, units.weightUnit),
    lengthMm: convertPrestashopDimensionToMm(product.depth, units.dimensionUnit),
    widthMm: convertPrestashopDimensionToMm(product.width, units.dimensionUnit),
    heightMm: convertPrestashopDimensionToMm(product.height, units.dimensionUnit),
  };
}
