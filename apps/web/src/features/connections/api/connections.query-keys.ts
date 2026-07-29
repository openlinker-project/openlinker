import type { ConnectionFilters } from './connections.types';

export const connectionsQueryKeys = {
  all: ['connections'] as const,
  list: (filters?: ConnectionFilters) =>
    ['connections', 'list', filters?.platformType ?? 'all', filters?.status ?? 'all'] as const,
  detail: (connectionId: string) => ['connections', 'detail', connectionId] as const,
  diagnostics: (connectionId: string) => ['connections', 'diagnostics', connectionId] as const,
  bankAccounts: (connectionId: string) => ['connections', 'bank-accounts', connectionId] as const,
  webhookStatus: (connectionId: string) =>
    ['connections', 'webhook-status', connectionId] as const,
  subiektBankAccounts: (connectionId: string) =>
    ['connections', 'subiekt-bank-accounts', connectionId] as const,
  subiektCashRegisters: (connectionId: string) =>
    ['connections', 'subiekt-cash-registers', connectionId] as const,
};
