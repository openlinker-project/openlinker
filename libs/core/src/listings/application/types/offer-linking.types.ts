/**
 * Offer Linking Types
 *
 * Public types for the offer-linking application service: link methods,
 * the per-batch lookup tables, and the per-offer linking result.
 *
 * @module libs/core/src/listings/application/types
 */

/**
 * Offer-link method values
 *
 * Ordered as the linking fallback chain in `OfferLinkingService.linkOffer`:
 * externalRef → sku → ean → gtin.
 */
export const OfferLinkMethodValues = ['externalRef', 'sku', 'ean', 'gtin'] as const;

/**
 * Offer-link method type
 *
 * Derived union from `OfferLinkMethodValues`.
 */
export type OfferLinkMethod = (typeof OfferLinkMethodValues)[number];

/**
 * Pre-built per-batch lookup tables passed to `OfferLinkingService.linkOffer`.
 *
 * Map values: variant id when uniquely matched, `null` when ambiguous
 * (multiple candidates), absent key when no candidate exists.
 */
export interface OfferLinkingLookups {
  externalRefToVariantId: Map<string, string | null>;
  skuToVariantId: Map<string, string | null>;
  eanToVariantId: Map<string, string | null>;
  gtinToVariantId: Map<string, string | null>;
}

/**
 * Per-offer linking outcome.
 */
export interface OfferLinkingResult {
  status: 'linked' | 'skipped';
  internalVariantId?: string;
  linkMethod?: OfferLinkMethod;
  reason?: string;
}
