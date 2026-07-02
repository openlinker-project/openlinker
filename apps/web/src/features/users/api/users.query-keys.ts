import type { UserListFilters } from './users.types';

export const usersQueryKeys = {
  all: ['users'] as const,
  list: (filters?: UserListFilters) =>
    ['users', 'list', filters?.status ?? 'all', filters?.page ?? 0, filters?.pageSize ?? 0] as const,
};
