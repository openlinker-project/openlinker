/**
 * Price Change Episode Types (#3142, ADR-072)
 *
 * The episode pattern applied to recurring price propagation — see
 * `ReservationShortfallEpisode` (`libs/core/src/inventory`) for the shape this
 * mirrors: a row opened once on first detection, updated in place on
 * re-detection (never duplicated), and closed by an explicit operator or
 * automatic-apply write.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * How an open episode was resolved.
 *
 * - `accepted`: the rule-computed price was published as-is.
 * - `accepted-custom`: the operator overrode the computed price
 *   (`manualPriceOverride`) before publishing it.
 * - `ignored`: the operator chose to keep the old (live) price.
 */
export const PriceChangeResolutionValues = ['accepted', 'accepted-custom', 'ignored'] as const;
export type PriceChangeResolution = (typeof PriceChangeResolutionValues)[number];

/**
 * Why an episode cannot proceed to a normal actionable state.
 *
 * Follows the `SalesDocumentBlockOutcome` discipline (`libs/core/src/sales-documents`):
 * a pure function decides the reason, the owning service persists it, and it is
 * re-decided on every relevant detection pass — never inferred client-side.
 *
 * `'currency-mismatch'` is the only reason in v1 (ADR-072 decision 4): a
 * source/destination currency mismatch is never silently converted.
 */
export const PriceChangeBlockReasonValues = ['currency-mismatch'] as const;
export type PriceChangeBlockReason = (typeof PriceChangeBlockReasonValues)[number];

export function isPriceChangeResolution(value: unknown): value is PriceChangeResolution {
  return (
    typeof value === 'string' &&
    (PriceChangeResolutionValues as readonly string[]).includes(value)
  );
}

export function isPriceChangeBlockReason(value: unknown): value is PriceChangeBlockReason {
  return (
    typeof value === 'string' && (PriceChangeBlockReasonValues as readonly string[]).includes(value)
  );
}

/**
 * Input to `PriceChangeEpisodeRepositoryPort.upsertOpen` — the episode-pattern
 * "open or refresh the same open row" write.
 */
export interface UpsertOpenPriceChangeEpisodeInput {
  productVariantId: string;
  destinationConnectionId: string;
  sourceConnectionId: string;
  sourceCurrency: string;
  sourceOldAmount: number;
  sourceNewAmount: number;
  computedOldAmount: number;
  computedNewAmount: number;
  blockReason: PriceChangeBlockReason | null;
  detectedAt: Date;
}

/**
 * Filters for the review-queue list read.
 *
 * Stale-variant exclusion (the #1689 precedent) is deliberately NOT a filter
 * here — it is applied ABOVE the repository, in `PriceChangesService.listOpen`
 * (#3162), which computes `staleVariantIds` via `IProductsService` and reports
 * `hiddenStaleCount` alongside the list. A repository-level flag with no reader
 * is worse than none: a future caller setting it would believe the guard ran
 * and get episodes for master-deleted products whose offers #1689 already
 * paused to quantity 0 (`docs/architecture-overview.md § Listings — Stale-
 * variant offer pause`; #2380's "a control the backend cannot serve is dead
 * code that type-checks").
 */
export interface PriceChangeEpisodeFilters {
  destinationConnectionId?: string;
  sourceConnectionId?: string;
  /** `undefined` = both directions. */
  direction?: 'up' | 'down';
  /** When `true`, only episodes with `|deltaPct| >= 10` (mockup's "Big changes"). */
  magnitudeLargeOnly?: boolean;
}
