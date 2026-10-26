/**
 * Price Change Apply Types (#3144, ADR-072, #3161 review)
 *
 * Input/result contract for `IPriceChangeApplyService.applyPriceChange` — the
 * core orchestration step (architecture-overview.md § 7 Sync Manager: "sync
 * orchestration policies live in core application services … not in worker
 * handlers") behind the `pricing.propagateToMarketplaces` job. Extracted out
 * of `apps/worker/src/sync/handlers/price-change-apply.handler.ts`, which
 * previously imported `PriceChangeEpisodeRepositoryPort` /
 * `PriceChangeAutoAppliedLogRepositoryPort` directly — a `*RepositoryPort`
 * cross-context import from a worker file, denied by
 * `check-cross-context-imports.mjs` (`docs/architecture-overview.md § Cross-
 * context dependencies in core`).
 *
 * @module libs/core/src/listings/domain/types
 */

export interface PriceChangeApplyInput {
  productVariantId: string;
  destinationConnectionId: string;
  sourceConnectionId: string;
  amount: number;
  currency: string;
  automatic: boolean;
  /** Present for an accept/edit/bulk-accept from the review queue (#3145), and
   * for every automatic-mode apply since #3159 (the detection service now
   * unconditionally opens/refreshes an episode before deciding whether to
   * also auto-apply). */
  episodeId?: string;
  /** Whether the amount above is an operator-pinned override, not the rule's. */
  manualPriceOverride?: boolean;
  resolvedByUserId?: string;
  /** Present when part of a bulk-accept wave (#3145/#3148). */
  batchId?: string;
}

/**
 * The business outcome of one apply attempt. `'ok'` on a successful publish;
 * `'business_failure'` for a DETERMINISTIC, non-retryable condition (a
 * currency-mismatch block, a missing episode, a destination with neither
 * capability enabled, …) — per ADR-007, this resolves the job normally
 * (`sync_jobs.status = 'succeeded'`, `outcome = 'business_failure'`) instead
 * of throwing, so the runner does not burn the retry ladder on a condition
 * retrying cannot fix. A transient failure (network error, an as-yet
 * unclassified marketplace/shop rejection) is thrown instead and left to
 * `SyncJobRunner`'s ordinary retry/backoff + per-plugin
 * `RetryClassifierPort` machinery.
 */
export interface PriceChangeApplyResult {
  outcome: 'ok' | 'business_failure';
  /** Present only when `outcome === 'business_failure'` — a short, logged
   * reason naming which deterministic condition was hit. */
  reason?: string;
}
