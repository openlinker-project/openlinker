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
