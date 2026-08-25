/**
 * Returns Query Keys
 *
 * @module apps/web/src/features/returns/api
 */
import type { ReturnFilters, ReturnPagination } from './returns.types';

export const returnsQueryKeys = {
  all: ['returns'] as const,
  list: (filters?: ReturnFilters, pagination?: ReturnPagination) =>
    ['returns', 'list', filters ?? {}, pagination ?? {}] as const,
  ingestionAvailability: () => ['returns', 'ingestion-availability'] as const,
};
