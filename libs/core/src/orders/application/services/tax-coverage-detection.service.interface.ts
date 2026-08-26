/**
 * Tax Coverage Detection Service Interface
 *
 * Contract for the Data Coverage panel's tax A/B/C detector (#2465) — see
 * `TaxCoverageDetectionService`'s doc comment for the full classification
 * rule and rationale.
 *
 * @module libs/core/src/orders/application/services
 */
import type { SalesAnalyticsFilters } from '../../domain/types/order-sales-analytics.types';
import type {
  CoverageDetectionPagination,
  PaginatedTaxCoverageOrders,
  TaxCoverageCategory,
  TaxCoverageClassification,
} from '../../domain/types/coverage-detection.types';

export interface ITaxCoverageDetectionService {
  /**
   * Classify every `netExcludedCount` candidate order (for the given
   * filters/currency) into its `'tax-a'` / `'tax-b'` / `'tax-c'` bucket.
   * The three returned arrays are a complete, non-overlapping partition of
   * the candidate population — their combined length always equals
   * `netExcludedCount` for the same filters/currency.
   */
  classify(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<TaxCoverageClassification>;

  /**
   * One category's drill-down page (mockup states `detail-tax` /
   * `detail-novat` / `detail-postrollout`), sliced from the same
   * classification pass {@link classify} runs. Pagination is applied
   * in-memory over the classified result — see the class doc comment for
   * why this cannot be pushed into SQL.
   */
  getCategoryPage(
    category: TaxCoverageCategory,
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    pagination: CoverageDetectionPagination
  ): Promise<PaginatedTaxCoverageOrders>;

  /**
   * Per-category counts, for the `GET /analytics/coverage` aggregate row
   * (#2466) — `affectedCount` per category without a caller needing to
   * fetch and slice a full page.
   */
  getCategoryCounts(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<Record<TaxCoverageCategory, number>>;

  /**
   * All three categories' drill-down pages in ONE {@link classify} pass
   * (#2466) — `AnalyticsCoverageController` needs `tax-a`/`tax-b`/`tax-c`
   * together for a single `GET /analytics/coverage` request, and calling
   * {@link getCategoryPage} three times would re-run the live-catalogue
   * classification pass three times over the SAME candidate population.
   */
  getAllCategoryPages(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    pagination: CoverageDetectionPagination
  ): Promise<Record<TaxCoverageCategory, PaginatedTaxCoverageOrders>>;
}
