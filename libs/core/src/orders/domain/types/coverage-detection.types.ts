/**
 * Coverage Detection Types
 *
 * Shared vocabulary for the `/analytics` Data Coverage panel's detectors
 * (epic #2452, mini-epic #2463) — the currency-mismatch detector (#2464,
 * this task) is the first consumer, and the tax A/B/C detector (#2465, this
 * extension) plus the product-matching detector + aggregate
 * `GET /analytics/coverage` endpoint (#2466) extend this same file. Kept
 * additive on purpose: nothing here is currency-specific except the types
 * explicitly named for it.
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
 * Data Coverage category values. `'currency'` was populated by #2464;
 * `'tax-a'`/`'tax-b'`/`'tax-c'` are added here by this task (#2465) — the
 * product-matching category (#2466) is added by that sibling task rather
 * than guessed at in advance.
 */
export const CoverageCategoryValues = ['currency', 'tax-a', 'tax-b', 'tax-c'] as const;

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

/**
 * Tax A/B/C sub-category values (#2465) — the three operator-actionable
 * partitions of the `netExcludedCount` population, each with a distinct
 * remediation path (see `TaxCoverageDetectionService`'s doc comment for the
 * classification rule):
 *
 * - `'tax-a'` — unconfirmed-but-resolvable: `taxRateEra = 'pre-rollout'` and
 *   every one of the order's unresolved lines DOES resolve a rate from the
 *   current catalogue (already backfilled, or resolvable right now). Would
 *   become net-eligible if Phase 5's `includeGuessedVatRatesInNetSales`
 *   setting were ON. Mockup `detail-tax`.
 * - `'tax-b'` — no tax rate at all: either (i) the order is excluded for a
 *   reason OTHER than the pre-rollout era (a post-rollout order with a
 *   genuinely unresolved line, or no line items), or (ii) it IS pre-rollout
 *   but the catalogue has been asked about at least one unresolved line's
 *   product/variant and confirmed it carries none. No remediation action
 *   exists for this category. Mockup `detail-novat`.
 * - `'tax-c'` — pre-rollout, not yet resolvable: `taxRateEra = 'pre-rollout'`,
 *   at least one unresolved line's product/variant has never been asked
 *   about a tax rate at all (`taxRateState === 'not-checked'`), and none of
 *   the order's unresolved lines were confirmed rate-less. A future catalogue
 *   sync (or the backfill sweep, once it reaches this connection's frontier)
 *   may still resolve it. Mockup `detail-postrollout`.
 */
export const TaxCoverageCategoryValues = ['tax-a', 'tax-b', 'tax-c'] as const;

/**
 * Tax coverage sub-category type — a narrowing of {@link CoverageCategory}
 * scoped to the three tax-only values.
 */
export type TaxCoverageCategory = (typeof TaxCoverageCategoryValues)[number];

/**
 * One order in a tax coverage sub-category's drill-down list. Deliberately
 * as minimal as {@link CurrencyMismatchOrderRow} — no thumbnail/order-number
 * field, since `OrderRecord` denormalizes no such column.
 */
export interface TaxCoverageOrderRow {
  internalOrderId: string;
  sourceConnectionId: string;
  /** `order_records.placedAt` — `null` for a historical row with no resolvable placement date. */
  placedAt: Date | null;
}

/**
 * Paginated result for {@link TaxCoverageOrderRow}, mirroring
 * {@link PaginatedCurrencyMismatchOrders}'s `{ items, total }` shape.
 */
export interface PaginatedTaxCoverageOrders {
  items: TaxCoverageOrderRow[];
  total: number;
}

/**
 * A `netExcludedCount` candidate order awaiting A/B/C classification — the
 * minimal shape `OrderRecordRepositoryPort.findNetExcludedOrderCandidates`
 * returns per row, before `TaxCoverageDetectionService` resolves each one's
 * category (a per-line, live-catalogue check that cannot be pushed into
 * SQL, so it happens in the application layer instead).
 */
export interface NetExcludedOrderCandidate {
  internalOrderId: string;
  sourceConnectionId: string;
  placedAt: Date | null;
  /**
   * Raw `order_records.taxRateEra` value. Kept as `string | null` here
   * (mirroring the ORM entity's own column type) rather than the narrower
   * `TaxRateEra` from `@openlinker/core/sales-documents` — that type lives in
   * a sibling context and `orders` already imports it only where the value
   * is a live column). Classification treats anything other than the
   * literal `'pre-rollout'` string as "not pre-rollout".
   */
  taxRateEra: string | null;
}

/**
 * Every {@link NetExcludedOrderCandidate} classified into its A/B/C bucket
 * (#2465). The three arrays are a complete partition of the input — every
 * candidate lands in exactly one — which is the regression guard the #2465
 * tests assert (`categoryA.length + categoryB.length + categoryC.length ===
 * candidates.length`, and by construction, `=== netExcludedCount`).
 */
export interface TaxCoverageClassification {
  'tax-a': TaxCoverageOrderRow[];
  'tax-b': TaxCoverageOrderRow[];
  'tax-c': TaxCoverageOrderRow[];
}
