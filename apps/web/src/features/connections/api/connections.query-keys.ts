import type { ConnectionFilters, ConnectionPagination } from './connections.types';

export const connectionsQueryKeys = {
  all: ['connections'] as const,
  list: (filters?: ConnectionFilters) =>
    ['connections', 'list', filters?.platformType ?? 'all', filters?.status ?? 'all'] as const,
  listPaginated: (filters?: ConnectionFilters, pagination?: ConnectionPagination) =>
    ['connections', 'list-paginated', filters ?? {}, pagination ?? {}] as const,
  detail: (connectionId: string) => ['connections', 'detail', connectionId] as const,
  diagnostics: (connectionId: string) => ['connections', 'diagnostics', connectionId] as const,
  bankAccounts: (connectionId: string) => ['connections', 'bank-accounts', connectionId] as const,
  webhookStatus: (connectionId: string) =>
    ['connections', 'webhook-status', connectionId] as const,
  rateLimitStatus: (connectionId: string) =>
    ['connections', 'rate-limit-status', connectionId] as const,
  catalogTrust: (connectionId: string) => ['connections', 'catalog-trust', connectionId] as const,
  syncStatus: (connectionId: string) => ['connections', 'sync-status', connectionId] as const,
  subiektBankAccounts: (connectionId: string) =>
    ['connections', 'subiekt-bank-accounts', connectionId] as const,
  subiektCashRegisters: (connectionId: string) =>
    ['connections', 'subiekt-cash-registers', connectionId] as const,
};
