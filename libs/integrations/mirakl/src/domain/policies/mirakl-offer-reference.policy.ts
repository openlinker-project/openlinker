/**
 * Mirakl Offer Reference Policy
 *
 * Which of an offer's `product_references` is its barcode. Mirakl lists every
 * identifier the catalogue card carries (EAN, ISBN, the operator's own ids);
 * only the GTIN-family ones are a barcode another channel can match on.
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import type { MiraklProductReference } from '../types/mirakl-offer.types';

const BARCODE_REFERENCE_TYPES: ReadonlySet<string> = new Set(['EAN', 'EAN13', 'GTIN', 'ISBN']);

/** The first GTIN-family reference, or `null` when the offer carries none. */
export function pickMiraklBarcode(
  references: readonly MiraklProductReference[] | undefined
): string | null {
  const found = (references ?? []).find(
    (reference) =>
      reference.reference &&
      BARCODE_REFERENCE_TYPES.has((reference.reference_type ?? '').toUpperCase())
  );
  return found?.reference ?? null;
}
