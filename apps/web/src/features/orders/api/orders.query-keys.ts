import type { OrderFilters, OrderPagination } from './orders.types';

export const ordersQueryKeys = {
  all: ['orders'] as const,
  list: (filters?: OrderFilters, pagination?: OrderPagination) =>
    ['orders', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (internalOrderId: string) => ['orders', 'detail', internalOrderId] as const,
};
