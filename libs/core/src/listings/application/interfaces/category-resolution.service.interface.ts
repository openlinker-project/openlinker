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
  EanCategoryMatchStreamEvent,
  EanCategoryMatchStreamOptions,
  EanMatchResult,
} from '@openlinker/core/listings';
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

  /**
   * Same resolution as `resolveCategoriesBatch`, delivered per variant as it
   * lands (#2207, epic #2205) so a caller can report progress instead of
   * waiting on one all-or-nothing answer.
   *
   * Emits at most one `result` event per input item followed by exactly one
   * `done` event, whose `completion` says whether the run finished
   * (`complete`), was cut short by the caller's signal (`aborted`) or threw
   * (`failed`). The terminal event is guaranteed on the failure path too - the
   * error is rethrown after it, so a consumer can always tell a truncated
   * stream from a finished one. A `result` for a variant the adapter re-emits,
   * or for one that was never in the input, is dropped rather than forwarded,
   * so `resolvedCount + unresolvedCount` can never exceed the input size.
   *
   * Three paths, all gated on declared capabilities:
   * - `EanCategoryMatcherStreaming` - streamed through as the adapter resolves.
   * - `EanCategoryMatcher` only - the batch call runs, then its results are
   *   emitted; the operator sees no intermediate progress, but the step works.
   * - neither - every item emits `no-match` and the stream terminates without a
   *   single marketplace call (a `borrows`-taxonomy destination such as Erli,
   *   ADR-025 §3; a first-class case per epic #2205 decision 4, not an error).
   *
   * The #1522 configured-mapping fallback applies per item on both matcher
   * paths, exactly as on the batch path, so the streamed preview cannot
   * disagree with what `OfferBuilderService` resolves at build time.
   *
   * Connection resolution is identical to `resolveCategoriesBatch`, so an
   * unknown/disabled connection or a non-marketplace one still surfaces its
   * usual error - raised from the first `next()`, since a generator body does
   * not run until iteration starts. The one exception is a signal that is
   * *already* aborted at the first `next()`: the connection is then never
   * resolved, so no such error can surface and the stream is a lone `done` with
   * `completion: 'aborted'`.
   *
   * `options.signal`, once aborted, stops further work being scheduled and the
   * stream ends with its `done` tally; in-flight marketplace calls are left to
   * settle (epic #2205 decision 5). An abort therefore *discards* verdicts the
   * adapter had already paid a marketplace call for, which is the intended
   * trade for a caller that aborts on navigation - a caller aborting on a
   * timeout instead should not expect the partial results back.
   */
  resolveCategoriesStream(
    connectionId: string,
    input: BatchCategoryResolveInput,
    options?: EanCategoryMatchStreamOptions,
  ): AsyncIterable<EanCategoryMatchStreamEvent>;
}
