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
  detail: (returnId: string) => ['returns', 'detail', returnId] as const,
  correctionProposal: (returnId: string) =>
    ['returns', 'correction-proposal', returnId] as const,
  // #2383 — keyed by ORDER, not by return: one order spans many returns.
  orderEvents: (internalOrderId: string) =>
    ['returns', 'order-events', internalOrderId] as const,
  // #2646 — keyed by RETURN. A distinct namespace from `orderEvents`: the two
  // reads answer different questions and an orphan has no order key at all.
  returnEvents: (returnId: string) => ['returns', 'return-events', returnId] as const,
};
