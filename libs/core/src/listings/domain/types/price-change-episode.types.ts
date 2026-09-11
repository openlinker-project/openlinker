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
 * `'currency-mismatch'` (ADR-072 decision 4): a source/destination currency
 * mismatch is never silently converted.
 *
 * `'destination-currency-unknown'` (#3159 review): an UNKNOWN destination
 * currency is never treated as "known to match" — the ADR-061 /
 * `buyerHasTaxId` (#2599) precedent applied here. It blocks the AUTOMATIC
 * bypass specifically (a currency OL cannot verify must never be published
 * without review) while still opening a reviewable episode, so the operator
 * is told OL cannot verify the currency rather than having it assumed away.
 * On the repo's current topology `Connection.config.currency` is written by
 * exactly one surface (a PrestaShop SOURCE setup form) and never by a
 * destination form, so this reason is expected to fire for most real
 * installs until a destination-currency-resolution follow-up ships (see
 * `readConnectionCurrency`'s docblock).
 */
export const PriceChangeBlockReasonValues = [
  'currency-mismatch',
  'destination-currency-unknown',
] as const;
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
  /**
   * `null` means "no prior source price was ever recorded" — a variant that
   * previously had no price at all, or a brand-new mapping (#3159 review,
   * BLOCKING). The caller must NEVER fall back to `sourceNewAmount` here: an
   * absent baseline fabricated as "old = new" reads on the operator surface
   * as a genuine, no-op price change that never happened.
   */
  sourceOldAmount: number | null;
  sourceNewAmount: number;
  /**
   * `null` means "no prior computed value to compare" — a brand-new mapping
   * with no recorded baseline (#3159 review). Never `0` overloaded as that
   * sentinel: `0` is a real (if edge-case) baseline — e.g. a previously-free
   * product now carrying a price — and `PriceChangeEpisode.deltaPct()` must
   * tell the two apart rather than reporting a fabricated "down" direction.
   */
  computedOldAmount: number | null;
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
  /**
   * `undefined` = every direction, including unknown. `'unknown'` asks for
   * exactly the episodes `PriceChangeEpisode.deltaPct()` returns `null` for
   * (no recorded baseline — a brand-new mapping's first detection, #3159
   * review): those rows are counted in the unfiltered total but were
   * previously unreachable under either `'up'` or `'down'`, which would make
   * an operator's per-direction counts silently undercount the whole.
   */
  direction?: 'up' | 'down' | 'unknown';
  /** When `true`, only episodes with `|deltaPct| >= 10` (mockup's "Big changes"). */
  magnitudeLargeOnly?: boolean;
  /**
   * When `true`, also surface a recently-`ignored` episode (the review
   * queue's row-level Undo affordance, #3162 review) — see
   * `PriceChangeEpisodeRepository`'s `RECENTLY_IGNORED_WINDOW_MS`. Excluded
   * from `countOpen`/`countOpenBySource`, which stay strictly "open".
   */
  includeRecentlyResolved?: boolean;
  /**
   * Page bounds for the review-queue read (#3162 review — the previously
   * unbounded `findOpenForConnection`/`findOpenAll` reads and hydrates the
   * WHOLE open set on every call, which is a real defect at catalogue scale:
   * one supplier price-file import across a 20k-SKU catalogue with two
   * destinations opens on the order of tens of thousands of episodes.
   *
   * Applied as a real SQL `LIMIT`/`OFFSET` over the SARGABLE predicates
   * (`resolvedAt IS NULL` + the optional connection filters), ordered by
   * `detectedAt DESC` — the same page every caller already sees. `direction`
   * / `magnitudeLargeOnly` remain application-code post-filters (they are
   * derived from `deltaPct`, not a stored column, per this file's repository
   * counterpart), so a page may legitimately return FEWER than `limit`
   * visible rows when either is active — the same approximation
   * `countOpen` already accepts for those two filters. `undefined` `limit`
   * means "no page requested" (a bare `getMany()`), kept only for callers
   * that have not yet adopted pagination (none remain in this tree after
   * #3162, but the port stays permissive rather than silently defaulting a
   * caller who forgot to pass one — see `DEFAULT_PRICE_CHANGE_PAGE_SIZE` /
   * `MAX_PRICE_CHANGE_PAGE_SIZE` at the one call site that resolves the
   * default, `PriceChangesService.listOpen`).
   */
  limit?: number;
  offset?: number;
}
