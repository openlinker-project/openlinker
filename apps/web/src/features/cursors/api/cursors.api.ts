/**
 * Cursors API
 *
 * Thin transport module for the cursors endpoints.
 *
 * @module apps/web/src/features/cursors/api
 */
import type {
  CursorFilters,
  CursorOverview,
  CursorPagination,
  PaginatedCursors,
  RewindCursorInput,
  RewindCursorResult,
} from './cursors.types';

export interface CursorsApi {
  list: (filters?: CursorFilters, pagination?: CursorPagination) => Promise<PaginatedCursors>;
  overview: (connectionId?: string) => Promise<CursorOverview>;
  rewind: (input: RewindCursorInput) => Promise<RewindCursorResult>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: CursorFilters, pagination?: CursorPagination): string {
  const params = new URLSearchParams();
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.keyPrefix) params.set('keyPrefix', filters.keyPrefix);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createCursorsApi(request: ApiRequest): CursorsApi {
  return {
    list(filters, pagination): Promise<PaginatedCursors> {
      return request<PaginatedCursors>(`/cursors${buildQuery(filters, pagination)}`);
    },
    overview(connectionId): Promise<CursorOverview> {
      const qs = connectionId ? `?connectionId=${encodeURIComponent(connectionId)}` : '';
      return request<CursorOverview>(`/cursors/overview${qs}`);
    },
    rewind({ connectionId, cursorKey, target }): Promise<RewindCursorResult> {
      return request<RewindCursorResult>(`/cursors/${encodeURIComponent(connectionId)}/rewind`, {
        method: 'POST',
        body: JSON.stringify({ cursorKey, target }),
      });
    },
  };
}
