import type { GetCurrencyMismatchOrdersInput } from './analytics-remediation.types';

export const analyticsRemediationQueryKeys = {
  all: ['analytics', 'remediation'] as const,
  status: (runId: string) => ['analytics', 'remediation', 'currency', 'status', runId] as const,
  currencyOrders: (input: GetCurrencyMismatchOrdersInput) =>
    ['analytics', 'remediation', 'currency', 'orders', input] as const,
};
