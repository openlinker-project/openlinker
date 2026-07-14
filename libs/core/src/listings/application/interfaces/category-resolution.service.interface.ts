/**
 * Category Resolution Service Interface
 *
 * Contract for the provenance-aware destination-category placement chain
 * (ADR-023 §1), each step capability-gated:
 * provision → barcode auto-detect → per-source-category mapping → manual.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { EanMatchResult } from '@openlinker/core/listings';
import type {
  BatchCategoryResolveInput,
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
   * Resolve marketplace categories for N variants in one batch (#795), EAN
   * first with a configured-mapping fallback (#1522).
   *
   * Primary path is the connection's `EanCategoryMatcher` sub-capability (#735).
   * When the EAN yields no catalogue match (or the variant carries no EAN) and
   * the item supplies `sourceCategoryIds`, the service consults the operator's
   * per-source-category mapping — the same mapping `OfferBuilderService` honours
   * at offer-build time — and returns a `matched` result with
   * `method: 'category_mapping'` (empty `productCardId`). This keeps the wizard
   * Resolve preview in agreement with build-time resolution.
   *
   * Drives the bulk-listing wizard's Resolve step (#792 PR 3), collapsing the
   * previous one-call-per-row loop into a single call.
   *
   * A destination that cannot batch-match EANs (a `borrows`-taxonomy
   * destination, e.g. Erli) degrades every item to `no-match` — it resolves the
   * category server-side at submit instead. Throws
   * `AdapterCapabilityNotSupportedException` when the resolved connection is not
   * an `OfferManager` marketplace at all. Returned map is keyed by `variantId`;
   * every input item has one entry.
   */
  resolveCategoriesBatch(
    connectionId: string,
    input: BatchCategoryResolveInput,
  ): Promise<Map<string, EanMatchResult>>;
}
