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
 * The product-matching detector (#2466) is the one genuinely new category —
 * no existing aggregate tracked it before this. It reuses the
 * `OrderRecordStatus` / `mappingFailureReason` vocabulary `OrderRecord`
 * already carries for the #1689 stale-variant treatment (`awaiting_mapping`
 * is self-healing, `source_deleted` is permanent) rather than inventing a
 * parallel signal.
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
import type { TaxRateState } from '@openlinker/core/products';

/**
 * Data Coverage category values. `'currency'` was populated by #2464,
 * `'tax-a'`/`'tax-b'`/`'tax-c'` by #2465, and `'product-matching'` (an order
 * stuck `recordStatus IN ('awaiting_mapping', 'source_deleted')`) by #2466.
 */
export const CoverageCategoryValues = [
  'currency',
  'tax-a',
  'tax-b',
  'tax-c',
  'product-matching',
] as const;

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
 * One line's resolved (or unresolved) tax-rate observation within a
 * {@link TaxCoverageOrderRow} (#2798) — carried per line rather than
 * collapsed to one order-level value, since a mixed-rate order can
 * legitimately carry a different real rate per line, and the mockup's
 * earlier "hardcoded 23%" bug is exactly the regression this guards
 * against.
 *
 * `rateCode` is the resolved code (a percent-as-string like `'23'`, or an
 * exemption code) when `state === 'known'` and `line.taxRate` already
 * carries a resolvable value; otherwise `null` — a `'no-rate'` or
 * `'not-checked'` state never fabricates a code. `TaxRateState` is the same
 * derived vocabulary `TaxCoverageDetectionService` already computes via
 * `taxRateState()` (`@openlinker/core/products`) — reused here rather than
 * re-derived, so the row can never disagree with the classification that
 * produced it.
 */
export interface TaxCoverageLineRateObservation {
  productId: string;
  variantId: string | null;
  /** Resolved rate code, or `null` when `state` is `'no-rate'` / `'not-checked'`. */
  rateCode: string | null;
  state: TaxRateState;
}

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
  /**
   * Per-line rate observations for every one of the order's lines (#2798)
   * — never a single order-level rate. Empty when the order carries no
   * line items at all.
   */
  lineRates: TaxCoverageLineRateObservation[];
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

/**
 * One order in the `'product-matching'` category's drill-down list (mockup
 * state `detail-mapping`, #2466) — an order stuck `recordStatus =
 * 'awaiting_mapping' | 'source_deleted'` because at least one item
 * reference failed resolution against the internal catalogue.
 * `mappingFailureReason` is the SAME column both statuses populate
 * (`OrderRecordService.updateItemResolutionFailure`, the #1689
 * stale-variant treatment) — reused here rather than re-deriving a parallel
 * signal, per this task's own scoping note.
 *
 * Deliberately as minimal as {@link CurrencyMismatchOrderRow} /
 * {@link TaxCoverageOrderRow} — no thumbnail/order-number field, since
 * `OrderRecord` denormalizes no such column. `placedAt` is omitted (unlike
 * its siblings): #1985 populates `placedAt`/`totalAmount` only for
 * `recordStatus = 'ready'` records, so a product-matching row's `placedAt`
 * is always `null` — `createdAt` (always populated) is the only resolvable
 * ordering/scoping timestamp for this category.
 */
export interface ProductMatchingErrorOrderRow {
  internalOrderId: string;
  sourceConnectionId: string;
  /** Always `'awaiting_mapping'` or `'source_deleted'` — the two `OrderRecordStatus` values this detector's predicate matches. */
  recordStatus: 'awaiting_mapping' | 'source_deleted';
  /** `order_records.mappingFailureReason` — set alongside both matched statuses (#1689). */
  mappingFailureReason: string | null;
  /** `order_records.createdAt` — always populated, unlike `placedAt` for this category (see class doc comment). */
  createdAt: Date;
}

/**
 * Paginated result for {@link ProductMatchingErrorOrderRow}, mirroring
 * {@link PaginatedCurrencyMismatchOrders}'s `{ items, total }` shape.
 */
export interface PaginatedProductMatchingErrorOrders {
  items: ProductMatchingErrorOrderRow[];
  total: number;
}
