/**
 * Bench line text
 *
 * The composed strings a parcel line shows in several places - its codes,
 * bin, weight, size and counts. Each reads the `bench.parcel.lines` copy when
 * it is called, never at module load, so the words and numbers follow the
 * active language.
 *
 * @module apps/web/src/features/bench/lib
 */
import {
  formatPlural,
  getBcp47Locale,
  getLocale,
  getMessages,
  interpolate,
} from '../../../shared/i18n';

const GRAMS_PER_KILOGRAM = 1000;

function formatNumber(value: number, fractionDigits = 0): string {
  return new Intl.NumberFormat(getBcp47Locale(getLocale()), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

/** `EAN 590... · SKU ABC`, omitting whichever code the line does not carry. */
export function formatBenchLineCodes(parts: {
  readonly ean: string | null;
  readonly sku: string | null;
}): string {
  const copy = getMessages('bench').parcel.lines.codes;
  return [
    parts.ean === null ? null : interpolate(copy.ean, { ean: parts.ean }),
    parts.sku === null ? null : interpolate(copy.sku, { sku: parts.sku }),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

export function formatBenchBinCode(code: string): string {
  return interpolate(getMessages('bench').parcel.lines.binCodeLabel, { code });
}

/** Grams below a kilogram, one decimal of kilograms above it. */
export function formatBenchWeight(grams: number): string {
  const copy = getMessages('bench').parcel.lines.weightGrams;
  if (grams < GRAMS_PER_KILOGRAM) return interpolate(copy.g, { value: formatNumber(grams) });
  const digits = grams % GRAMS_PER_KILOGRAM === 0 ? 0 : 1;
  return interpolate(copy.kg, { value: formatNumber(grams / GRAMS_PER_KILOGRAM, digits) });
}

export function formatBenchDimensions(lengthMm: number, widthMm: number, heightMm: number): string {
  return interpolate(getMessages('bench').parcel.lines.dimensionsMm, {
    length: formatNumber(lengthMm),
    width: formatNumber(widthMm),
    height: formatNumber(heightMm),
  });
}

/** `2 of 3`. */
export function formatBenchLineCount(verified: number, required: number): string {
  return interpolate(getMessages('bench').parcel.lines.count, { verified, required });
}

export function formatBenchStillToScan(remaining: number): string {
  return formatPlural(remaining, getMessages('bench').parcel.lines.stillToScan, getLocale());
}
