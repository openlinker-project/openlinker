/**
 * Category Resolution Types
 *
 * Types for Allegro category resolution during offer creation.
 * The resolution service uses a 3-step fallback chain:
 * auto-detect by barcode → category mapping → manual.
 *
 * @module libs/core/src/listings/application/types
 */

export const CategoryResolutionMethodValues = [
  'auto_detect',
  'category_mapping',
  'manual',
] as const;

export type CategoryResolutionMethod = (typeof CategoryResolutionMethodValues)[number];

export interface CategoryResolutionInput {
  /** Allegro marketplace connection ID */
  connectionId: string;
  /**
   * EAN or GTIN barcode for auto-detect (step 1).
   * If omitted, auto-detect is skipped entirely.
   */
  barcode?: string | null;
  /**
   * Source platform category IDs for mapping fallback (step 2), ordered deepest-first.
   * If both `barcode` and `sourceCategoryIds` are omitted, resolution returns `manual`.
   */
  sourceCategoryIds?: string[];
}

export interface CategoryResolutionResult {
  /** Resolved Allegro category ID, or null if manual pick is needed */
  allegroCategoryId: string | null;
  /** Which resolution method produced the result */
  method: CategoryResolutionMethod;
}
