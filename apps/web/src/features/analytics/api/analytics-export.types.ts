/**
 * Analytics CSV export types (#3590)
 *
 * One request shape per exportable report. Every request carries exactly the
 * filters the matching on-screen table was rendered with, so the file and the
 * screen describe the same rows.
 *
 * @module features/analytics/api
 */
import type { NetGrossBasis } from './analytics-settings.types';
import type { MarginFilters, MarginSortBy } from './margin-analytics.types';
import type { TopProductsSortBy } from './top-products.types';

export type AnalyticsCsvExportRequest =
  | { report: 'sales-channel'; filters: MarginFilters; basis: NetGrossBasis }
  | {
      report: 'top-products';
      filters: MarginFilters;
      basis: NetGrossBasis;
      sortBy: TopProductsSortBy;
    }
  | { report: 'margin-channel'; filters: MarginFilters }
  | { report: 'margin-product'; filters: MarginFilters; sortBy: MarginSortBy };

export interface AnalyticsCsvFile {
  blob: Blob;
  /** Server-chosen name; `null` when the response named none. */
  filename: string | null;
}
