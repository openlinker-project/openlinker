/**
 * Analytics Coverage types
 *
 * Mirrors `AnalyticsCoverageResponseDto` / `CoverageCategoryRowDto`
 * (`GET /analytics/coverage`, #2466, epic #2452 mini-epic #2463) — one row
 * per Data Coverage category. `status` is `'open'` for every row on this
 * build except `'currency'`, which the remediation run can move to
 * `'in-progress'` / `'resolved'` / `'failed'`.
 *
 * @module features/analytics/api
 */
export const COVERAGE_CATEGORY_VALUES = [
  'currency',
  'tax-a',
  'tax-b',
  'tax-c',
  'product-matching',
  'no-cost',
] as const;
export type CoverageCategory = (typeof COVERAGE_CATEGORY_VALUES)[number];

export const COVERAGE_RESOLUTION_STATUS_VALUES = ['open', 'in-progress', 'resolved', 'failed'] as const;
export type CoverageResolutionStatus = (typeof COVERAGE_RESOLUTION_STATUS_VALUES)[number];

/**
 * What `affectedCount` counts. Every category counts orders except
 * `'no-cost'` (G11-D), which counts order LINES: a cost gap is a property of
 * a line, and one order can hold several.
 */
export const COVERAGE_COUNT_UNIT_VALUES = ['orders', 'lines'] as const;
export type CoverageCountUnit = (typeof COVERAGE_COUNT_UNIT_VALUES)[number];

export interface CoverageCategoryRow {
  category: CoverageCategory;
  /** Absent reads as `'orders'` (a payload from before G11). */
  countUnit?: CoverageCountUnit;
  status: CoverageResolutionStatus;
  affectedCount: number;
  sampleOrderIds: string[];
  /**
   * The in-flight `analytics_remediation_runs` id when `status` is
   * `'in-progress'` — only ever set for the `'currency'` row. Present so a
   * page reload recovers the live sub-state instead of only tracking it in
   * local component state from the moment the operator clicked
   * "Recalculate now" in the current session (#2475).
   */
  activeRunId?: string | null;
}

export interface AnalyticsCoverage {
  categories: CoverageCategoryRow[];
}

export interface AnalyticsCoverageFilters {
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, exclusive. */
  to: string;
  sourceConnectionId?: string;
}

/**
 * Mirrors `AnalyticsCoverageByConnectionResponseDto` / `CoverageCategoryConnectionRowsDto`
 * (`GET /analytics/coverage/by-connection`, #2713) — one entry per category
 * (`'currency' | 'tax-a' | 'tax-b' | 'tax-c'`, never `'product-matching'`),
 * each carrying the affected-order count per `sourceConnectionId`. Replaces
 * `useCoverageCrossReferenceQuery`'s client-side page-draining grouping for
 * `ChannelSalesTable` (#2714).
 */
export interface CoverageConnectionRow {
  sourceConnectionId: string;
  affectedCount: number;
}

export interface CoverageCategoryConnectionRows {
  category: CoverageCategory;
  rows: CoverageConnectionRow[];
}

export interface AnalyticsCoverageByConnection {
  categories: CoverageCategoryConnectionRows[];
}
