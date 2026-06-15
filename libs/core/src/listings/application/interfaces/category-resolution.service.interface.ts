/**
 * Category Resolution Service Interface
 *
 * Contract for the provenance-aware destination-category placement chain
 * (ADR-023 §1), each step capability-gated:
 * provision → barcode auto-detect → per-source-category mapping → manual.
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
   * Resolve the destination category for a listing.
   *
   * Capability-gated chain (ADR-023 §1):
   * 1. Provision — mirror/create on the destination (`CategoryProvisioner`, #1041)
   * 2. Auto-detect via GTIN/EAN — query the destination catalog (`CategoryBarcodeMatcher`)
   * 3. Category mapping — look up source category in configured mappings
   * 4. Manual — return null for the operator to pick
   *
   * Returns `{ destinationCategoryId, provenance, method }`; `provenance`
   * (owns/borrows/open) describes the destination taxonomy relationship.
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
