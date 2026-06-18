import type { OrderFilters, OrderPagination, OrderHealthSummaryFilters } from './orders.types';

export const ordersQueryKeys = {
  all: ['orders'] as const,
  list: (filters?: OrderFilters, pagination?: OrderPagination) =>
    ['orders', 'list', filters ?? {}, pagination ?? {}] as const,
  statusSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'status-summary', filters ?? {}] as const,
  slaSummary: (filters?: OrderHealthSummaryFilters) =>
    ['orders', 'sla-summary', filters ?? {}] as const,
  detail: (internalOrderId: string) => ['orders', 'detail', internalOrderId] as const,
};
