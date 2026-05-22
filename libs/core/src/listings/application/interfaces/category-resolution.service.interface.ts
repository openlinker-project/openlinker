/**
 * Category Resolution Service Interface
 *
 * Contract for resolving the marketplace category for an offer using a 3-step
 * fallback chain: auto-detect by barcode → category mapping → manual.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type {
  BatchCategoryByEanInput,
  EanMatchResult,
} from '@openlinker/core/listings';
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

  /**
   * Resolve marketplace categories for N variant EANs in one batch (#795).
   *
   * Thin pass-through to the connection's `EanCategoryMatcher` sub-capability
   * (#735) — EAN-only, no mapping fallback. Drives the bulk-listing wizard's
   * Resolve step (#792 PR 3), collapsing the previous one-call-per-row loop
   * into a single call.
   *
   * Throws `AdapterCapabilityNotSupportedException` when the resolved
   * `OfferManager` adapter does not implement `EanCategoryMatcher`.
   * Returned map is keyed by `variantId`; every input item has one entry.
   */
  resolveCategoriesBatch(
    connectionId: string,
    input: BatchCategoryByEanInput,
  ): Promise<Map<string, EanMatchResult>>;
}
