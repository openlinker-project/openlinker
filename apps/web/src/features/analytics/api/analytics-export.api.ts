/**
 * Analytics CSV export client (#3590)
 *
 * Calls the same routes the screen reads with `format=csv`. The download goes
 * through the authenticated client (`requestFile`), never a plain link: a
 * browser navigation cannot send the bearer header.
 *
 * @module features/analytics/api
 */
import type { AnalyticsCsvExportRequest, AnalyticsCsvFile } from './analytics-export.types';
import { buildMarginRangeParams } from './margin-analytics.api';

interface ApiFileRequest {
  (path: string, init?: RequestInit): Promise<AnalyticsCsvFile>;
}

export interface AnalyticsExportApi {
  exportCsv: (request: AnalyticsCsvExportRequest) => Promise<AnalyticsCsvFile>;
}

function buildExportPath(request: AnalyticsCsvExportRequest): string {
  const params = buildMarginRangeParams(request.filters);
  params.set('format', 'csv');
  switch (request.report) {
    case 'sales-channel':
      params.set('basis', request.basis);
      return `/analytics/sales?${params.toString()}`;
    case 'top-products':
      params.set('basis', request.basis);
      params.set('sortBy', request.sortBy);
      return `/analytics/top-products?${params.toString()}`;
    case 'margin-channel':
      return `/analytics/margin?${params.toString()}`;
    case 'margin-product':
      params.set('sortBy', request.sortBy);
      return `/analytics/margin/products?${params.toString()}`;
    default: {
      const exhaustive: never = request;
      throw new Error(`Unhandled export report: ${String((exhaustive as { report: string }).report)}`);
    }
  }
}

export function createAnalyticsExportApi(requestFile: ApiFileRequest): AnalyticsExportApi {
  return {
    exportCsv: (request) => requestFile(buildExportPath(request)),
  };
}
