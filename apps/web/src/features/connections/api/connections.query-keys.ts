import type { ConnectionFilters } from './connections.types';

export const connectionsQueryKeys = {
  all: ['connections'] as const,
  list: (filters?: ConnectionFilters) =>
    ['connections', 'list', filters?.platformType ?? 'all', filters?.status ?? 'all'] as const,
  detail: (connectionId: string) => ['connections', 'detail', connectionId] as const,
};
