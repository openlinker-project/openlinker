/**
 * Coverage Detection Types
 *
 * Shared vocabulary for the `/analytics` Data Coverage panel's detectors
 * (epic #2452, mini-epic #2463) — the currency-mismatch detector (#2464,
 * this task) is the first consumer, and the tax A/B/C detector (#2465) plus
 * the product-matching detector + aggregate `GET /analytics/coverage`
 * endpoint (#2466) extend this same file. Kept additive on purpose: nothing
 * here is currency-specific except the types explicitly named for it.
 *
 * `CoverageCategory` / `CoverageResolutionStatus` follow the Phase 1 Task 1.2
 * decision doc (`docs/plans/analytics-coverage-remediation-decision.md`,
 * still unmerged as of this task — PR #2487): lifecycle (open/in-progress/
 * resolved/failed) is tracked independently of display tone (success/
 * warning/critical), mirroring the existing `deriveOrderHealth` /
 * `ConnectionIngestionStatus` precedent of one closed lifecycle union plus a
 * pure derivation function — `deriveCoverageDisplay` is that function's home
 * once a consumer needs it; this task does not need it, so it is not added
 * here speculatively.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Data Coverage category values. Only `'currency'` is populated by this
 * task (#2464) — the tax A/B/C categories (#2465) and the product-matching
 * category (#2466) are added here by those sibling tasks rather than
 * guessed at in advance.
 */
export const CoverageCategoryValues = ['currency'] as const;

/**
 * Data Coverage category type — one row per category in the
 * `GET /analytics/coverage` response (#2466).
 */
export type CoverageCategory = (typeof CoverageCategoryValues)[number];

/**
 * Lifecycle status for a Data Coverage category row. Per the decision doc,
 * this is lifecycle-only — `'open'`/`'in-progress'` describe whether a
 * remediation run exists and has finished, `'resolved'`/`'failed'` describe
 * how it ended. Every detector reports `'open'` today (Phase 5 is the only
 * writer of the other three values, and only for the `'currency'` category).
 */
export const CoverageResolutionStatusValues = ['open', 'in-progress', 'resolved', 'failed'] as const;

/**
 * Lifecycle status type, shared by every Data Coverage category.
 */
export type CoverageResolutionStatus = (typeof CoverageResolutionStatusValues)[number];

/**
 * Page/limit pagination shape for a Data Coverage detail-row read, mirroring
 * {@link OrderRecordPagination} — a distinct type (rather than reusing that
 * one directly) so a coverage-specific constraint (e.g. a smaller max page
 * size for a UI drill-down list) can be added later without widening the
 * order-list pagination contract.
 */
export interface CoverageDetectionPagination {
  limit: number;
  offset: number;
}

/**
 * One affected order in the `'currency'` category's paginated drill-down
 * list (mockup state `detail-currency`). Deliberately does NOT carry a
 * thumbnail/order-number field — `OrderRecord` denormalizes no such column,
 * and inventing one here would assert data that does not exist; `apps/api`
 * is free to add a hydration step from `orderSnapshot` later if the FE
 * genuinely needs it, but that's a interfaces-layer concern, not this read.
 *
 * Covers BOTH currency-mismatch populations under one shape (#2464): a row
 * with `stampedCurrency: null` was never stamped, a row with a non-null
 * `stampedCurrency` that differs from the current reporting-currency setting
 * was stamped against a prior era (ADR-040 §Decision 7's restatement case).
 * The mockup does not distinguish the two to the operator — see
 * `findCurrencyMismatchOrders`'s doc comment for the combined predicate.
 */
export interface CurrencyMismatchOrderRow {
  internalOrderId: string;
  sourceConnectionId: string;
  /** `order_records.currency` — the order's own native currency, `null` for a historical row predating that column. */
  nativeCurrency: string | null;
  /** `order_records.reportingCurrency` — `null` when the order has never been stamped at all. */
  stampedCurrency: string | null;
  /** `order_records.fxStampedAt` — `null` while a stamp attempt is still deferred (or never attempted). */
  stampedAt: Date | null;
}

/**
 * Paginated result for {@link CurrencyMismatchOrderRow}, mirroring
 * `PaginatedOrderRecords`'s `{ items, total }` shape.
 */
export interface PaginatedCurrencyMismatchOrders {
  items: CurrencyMismatchOrderRow[];
  total: number;
}
