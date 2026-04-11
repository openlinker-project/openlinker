/**
 * Cursors API Client
 *
 * Thin API module for the cursors feature. Provides typed methods for
 * listing connection cursors with optional filters and pagination.
 *
 * @module apps/web/src/features/cursors/api
 */
import type {
  CursorFilters,
  CursorPagination,
  PaginatedCursors,
} from './cursors.types';

export interface CursorsApi {
  list: (filters?: CursorFilters, pagination?: CursorPagination) => Promise<PaginatedCursors>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(filters?: CursorFilters, pagination?: CursorPagination): string {
  const params = new URLSearchParams();
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
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
  };
}
