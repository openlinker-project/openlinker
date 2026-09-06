import type { OrderFilters, OrderPagination, OrderHealthSummaryFilters } from './orders.types';

export const ordersQueryKeys = {
  all: ['orders'] as const,
  list: (filters?: OrderFilters, pagination?: OrderPagination) =>
    ['orders', 'list', filters ?? {}, pagination ?? {}] as const,
  /** The rows-only page (#2947) - a different response shape, so a different key. */
  rows: (filters?: OrderFilters, pagination?: OrderPagination) =>
    ['orders', 'rows', filters ?? {}, pagination ?? {}] as const,
  /**
   * The two-stage total (#2947). Carries NO pagination on purpose: the answer
   * depends on the filters alone, so paging reuses one cached count instead of
   * re-running the 142 ms aggregate #2843 measured.
   */
  count: (filters?: OrderFilters) => ['orders', 'count', filters ?? {}] as const,
  statusSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'status-summary', filters ?? {}] as const,
  slaSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'sla-summary', filters ?? {}] as const,
  lifecycleSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'lifecycle-summary', filters ?? {}] as const,
  detail: (internalOrderId: string) => ['orders', 'detail', internalOrderId] as const,
};
