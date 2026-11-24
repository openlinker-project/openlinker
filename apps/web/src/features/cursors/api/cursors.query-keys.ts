/**
 * Cursors Query Keys
 *
 * @module apps/web/src/features/cursors/api
 */
import type { CursorFilters, CursorPagination } from './cursors.types';

export const cursorsQueryKeys = {
  all: ['cursors'] as const,
  list: (filters?: CursorFilters, pagination?: CursorPagination) =>
    ['cursors', 'list', filters ?? {}, pagination ?? {}] as const,
  overview: (connectionId?: string) => ['cursors', 'overview', connectionId ?? 'all'] as const,
};
