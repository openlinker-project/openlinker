import type { CustomerFilters, CustomerPagination } from './customers.types';

export const customersQueryKeys = {
  all: ['customers'] as const,
  list: (filters?: CustomerFilters, pagination?: CustomerPagination) =>
    ['customers', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['customers', 'detail', id] as const,
};
