/**
 * Barcode Normalization Helper
 *
 * Provides canonical normalization for barcode values (EAN/GTIN).
 * Strips non-digit characters, preserves leading zeros, and validates length.
 *
 * @module libs/core/src/products/domain/utils
 */
const VALID_BARCODE_LENGTHS = new Set([8, 10, 12, 13, 14]);

export const normalizeBarcode = (input?: string | null): string | null => {
  if (!input) {
    return null;
  }
  const digitsOnly = input.trim().replace(/\D/g, '');
  if (digitsOnly.length === 0) {
    return null;
  }
  if (!VALID_BARCODE_LENGTHS.has(digitsOnly.length)) {
    return null;
  }
  return digitsOnly;
};

/**
 * Normalize a barcode to EAN-13.
 *
 * UPC-A (12 digits) is a strict subset of EAN-13 — the standard conversion is to
 * prepend a leading zero. All other valid barcode lengths (8, 10, 14) are rejected
 * because they cannot be unambiguously represented as EAN-13.
 * Returns null for anything that doesn't normalize to a 12- or 13-digit string.
 */
export const normalizeToEan13 = (input?: string | null): string | null => {
  const normalized = normalizeBarcode(input);
  if (!normalized) return null;
  if (normalized.length === 13) return normalized;
  if (normalized.length === 12) return `0${normalized}`;
  return null;
};
