/**
 * Invoice numbering query keys
 *
 * @module apps/web/src/features/invoicing/api
 */
import type { ListNumberingSeriesFilter } from './numbering.types';

export const numberingQueryKeys = {
  all: ['invoice-numbering'] as const,
  seriesList: (filter?: ListNumberingSeriesFilter) =>
    ['invoice-numbering', 'series', 'list', filter ?? {}] as const,
  unassigned: () => ['invoice-numbering', 'series', 'unassigned'] as const,
  series: (seriesId: string) => ['invoice-numbering', 'series', 'detail', seriesId] as const,
  audit: (seriesId: string, onlyGaps: boolean) =>
    ['invoice-numbering', 'series', 'audit', seriesId, onlyGaps] as const,
  routes: (connectionId: string) => ['invoice-numbering', 'routes', connectionId] as const,
};
