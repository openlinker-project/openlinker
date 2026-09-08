import type { CustomerFilters, CustomerPagination } from './customers.types';

export const customersQueryKeys = {
  all: ['customers'] as const,
  list: (filters?: CustomerFilters, pagination?: CustomerPagination) =>
    ['customers', 'list', filters ?? {}, pagination ?? {}] as const,
  /**
   * The two-stage total (#2947). Carries NO pagination on purpose: the answer
   * depends on the filters alone, so paging reuses one cached count instead of
   * recomputing the aggregate per page.
   */
  /** The rows-only page (#2947) - a different response shape, so a different key. */
  rows: (filters?: CustomerFilters, pagination?: CustomerPagination) =>
    ['customers', 'rows', filters ?? {}, pagination ?? {}] as const,
  count: (filters?: CustomerFilters) => ['customers', 'count', filters ?? {}] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
};
