/**
 * Ean Category Matcher Streaming Capability
 *
 * Optional sub-capability of `OfferManagerPort` - the incremental sibling of
 * `EanCategoryMatcher` (#2207, epic #2205 decision 2). An adapter that can
 * hand back each variant's verdict as it resolves declares
 * `implements OfferManagerPort, EanCategoryMatcherStreaming`.
 *
 * A separate capability rather than a wider `EanCategoryMatcher`: the batch
 * method has live call sites and adapters, and ADR-002's composable
 * sub-capabilities exist precisely so a richer shape can be added without
 * invalidating the narrower one. An adapter that ships only the batch method
 * keeps working - `CategoryResolutionService` falls back to it and emits its
 * results at the end.
 *
 * See `ean-category-matcher.capability.ts` for the batch contract and
 * `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { OfferManagerPort } from '../offer-manager.port';
import type { BatchCategoryByEanInput } from '../../types/ean-category-match.types';
import type {
  EanCategoryMatchStreamItem,
  EanCategoryMatchStreamOptions,
} from '../../types/ean-category-match-stream.types';
import type { ResolveConcurrencyCeiling } from '../../types/resolve-concurrency.types';

/**
 * Manifest name an adapter advertises this sub-capability under. See
 * `EAN_CATEGORY_MATCHER_CAPABILITY` for why it is a shared const.
 */
export const EAN_CATEGORY_MATCHER_STREAMING_CAPABILITY = 'EanCategoryMatcherStreaming';

export interface EanCategoryMatcherStreaming {
  /**
   * Resolve marketplace categories for N variant EANs, yielding each variant's
   * outcome as it lands instead of one map at the end.
   *
   * Same per-item semantics as `EanCategoryMatcher.resolveCategoriesForBatchByEan`:
   * - Variants without an EAN (`null`, empty, whitespace-only) yield
   *   `{ kind: 'no-ean' }` and never produce an HTTP call.
   * - Per-EAN HTTP failures collapse to `{ kind: 'no-match' }` (no-throw
   *   contract, mirrors #431); the stream never aborts on per-item failure.
   * - Every input item is yielded exactly once, in whatever order results
   *   settle - a consumer keys on `variantId`, never on position.
   *
   * `options.signal`, when aborted, stops the adapter scheduling further
   * marketplace calls and ends the iteration; already-issued calls are left to
   * settle and their results discarded (ADR-047 § Consequences, "Cancellation is
   * coarse"), so the stream may end short of the input
   * size.
   *
   * Call sites narrow via `isEanCategoryMatcherStreaming(adapter)`.
   */
  streamCategoriesForBatchByEan(
    input: BatchCategoryByEanInput,
    options?: EanCategoryMatchStreamOptions,
  ): AsyncIterable<EanCategoryMatchStreamItem>;

  /**
   * How many marketplace calls this adapter keeps in flight during one streamed
   * resolve run, and where that number came from (#2229).
   *
   * OPTIONAL, because an adapter may stream without pacing itself at all - and
   * because the ceiling is a real, operator-affecting number, "I don't declare
   * one" has to be expressible rather than fabricated by the caller.
   *
   * The value MUST be the ceiling the adapter actually enforces on its next
   * `streamCategoriesForBatchByEan` call, not a nominal constant: a reported
   * ceiling that differs from the enforced one is a worse defect than the
   * invisible ceiling this method exists to remove. Implementations derive both
   * from one function rather than stating the number twice.
   *
   * Callers MUST probe for the method (`typeof adapter.getStreamConcurrency ===
   * 'function'`) rather than relying on `isEanCategoryMatcherStreaming`, which
   * tests only `streamCategoriesForBatchByEan`. An out-of-tree plugin compiled
   * against an older `libs/core` satisfies that guard and would throw here.
   * Widening the guard was rejected for the same reason it was in ADR-046: it
   * would silently stop recognising such a plugin for streaming at all.
   */
  getStreamConcurrency?(): ResolveConcurrencyCeiling;
}

export function isEanCategoryMatcherStreaming(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & EanCategoryMatcherStreaming {
  return (
    typeof (adapter as Partial<EanCategoryMatcherStreaming>).streamCategoriesForBatchByEan ===
    'function'
  );
}
