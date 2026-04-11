import type { CursorFilters, CursorPagination } from './cursors.types';

export const cursorsQueryKeys = {
  all: ['cursors'] as const,
  list: (filters?: CursorFilters, pagination?: CursorPagination) =>
    ['cursors', 'list', filters ?? {}, pagination ?? {}] as const,
};
