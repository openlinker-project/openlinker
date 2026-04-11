/**
 * Auto-Match Types
 *
 * Types for the auto-match variant-to-offer feature. Defines result structures,
 * options, and job payloads for matching PrestaShop variants to Allegro offers
 * by shared identifiers (EAN/SKU).
 *
 * @module libs/core/src/products/application/types
 */

/**
 * Match method used to link a variant to an offer.
 */
export type AutoMatchMethod = 'ean' | 'sku';

/**
 * Error encountered during auto-match for a specific variant.
 */
export interface MatchError {
  variantId: string;
  offerId: string;
  method: AutoMatchMethod;
  reason: string;
}

/**
 * Result of an auto-match operation.
 */
export interface AutoMatchResult {
  matched: number;
  skippedAmbiguous: number;
  skippedNoMatch: number;
  errors: MatchError[];
}

/**
 * Options for running an auto-match operation.
 */
export interface AutoMatchOptions {
  dryRun?: boolean;
}

/**
 * Job payload for the master.variants.autoMatch job type.
 */
export interface AutoMatchVariantsJobPayload {
  schemaVersion: 1;
  dryRun?: boolean;
}

/**
 * Identifiers extracted from a marketplace offer for matching.
 */
export interface OfferIdentifiers {
  offerId: string;
  ean: string | null;
  sku: string | null;
}

/**
 * Internal result of matching a single variant against offer lookups.
 */
export type MatchResult =
  | { status: 'matched'; offerId: string; method: AutoMatchMethod }
  | { status: 'ambiguous'; method: AutoMatchMethod }
  | { status: 'no_match' };
