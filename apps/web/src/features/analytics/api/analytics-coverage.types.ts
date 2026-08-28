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
] as const;
export type CoverageCategory = (typeof COVERAGE_CATEGORY_VALUES)[number];

export const COVERAGE_RESOLUTION_STATUS_VALUES = ['open', 'in-progress', 'resolved', 'failed'] as const;
export type CoverageResolutionStatus = (typeof COVERAGE_RESOLUTION_STATUS_VALUES)[number];

export interface CoverageCategoryRow {
  category: CoverageCategory;
  status: CoverageResolutionStatus;
  affectedCount: number;
  sampleOrderIds: string[];
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
