/**
 * Category Resolution Service Interface
 *
 * Contract for resolving the marketplace category for an offer using a 3-step
 * fallback chain: auto-detect by barcode → category mapping → manual.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  CategoryResolutionInput,
  CategoryResolutionResult,
} from '../types/category-resolution.types';

export interface ICategoryResolutionService {
  /**
   * Resolve the marketplace category for an offer.
   *
   * Fallback chain:
   * 1. Auto-detect via GTIN/EAN — query marketplace for matching categories
   * 2. Category mapping — look up source category in configured mappings
   * 3. Manual — return null for merchant to pick
   */
  resolveCategory(input: CategoryResolutionInput): Promise<CategoryResolutionResult>;
}
