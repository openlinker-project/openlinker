/**
 * Invoice numbering query keys (#1577)
 *
 * @module apps/web/src/features/invoicing/api
 */
export const numberingQueryKeys = {
  all: ['invoice-numbering'] as const,
  seriesList: () => ['invoice-numbering', 'series', 'list'] as const,
  unassigned: () => ['invoice-numbering', 'series', 'unassigned'] as const,
  series: (seriesId: string) => ['invoice-numbering', 'series', 'detail', seriesId] as const,
  assignment: (connectionId: string) =>
    ['invoice-numbering', 'assignment', connectionId] as const,
};
