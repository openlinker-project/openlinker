/**
 * Stream Dead Letters API Client
 *
 * Thin, read-only API module for the poison-stream-entry terminal state
 * (#2301, D48). No replay/mutation methods in this pass.
 *
 * @module apps/web/src/features/sync-jobs/api
 */
import type {
  StreamDeadLetterFilters,
  StreamDeadLetterPagination,
  PaginatedStreamDeadLetters,
  StreamDeadLettersCount,
} from './stream-dead-letters.types';

export interface StreamDeadLettersApi {
  list: (
    filters?: StreamDeadLetterFilters,
    pagination?: StreamDeadLetterPagination
  ) => Promise<PaginatedStreamDeadLetters>;
  count: (filters?: StreamDeadLetterFilters) => Promise<StreamDeadLettersCount>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(
  filters?: StreamDeadLetterFilters,
  pagination?: StreamDeadLetterPagination
): string {
  const params = new URLSearchParams();
  if (filters?.stream) params.set('stream', filters.stream);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createStreamDeadLettersApi(request: ApiRequest): StreamDeadLettersApi {
  return {
    list(filters, pagination): Promise<PaginatedStreamDeadLetters> {
      return request<PaginatedStreamDeadLetters>(
        `/sync/stream-dead-letters${buildQuery(filters, pagination)}`
      );
    },
    count(filters): Promise<StreamDeadLettersCount> {
      const qs = filters?.stream ? `?stream=${encodeURIComponent(filters.stream)}` : '';
      return request<StreamDeadLettersCount>(`/sync/stream-dead-letters/count${qs}`);
    },
  };
}
