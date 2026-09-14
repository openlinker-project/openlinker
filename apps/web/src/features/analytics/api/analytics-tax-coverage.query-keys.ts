import type { GetTaxCoverageOrdersInput } from './analytics-tax-coverage.types';

export const analyticsTaxCoverageQueryKeys = {
  all: ['analytics', 'tax-coverage'] as const,
  orders: (input: GetTaxCoverageOrdersInput) => ['analytics', 'tax-coverage', 'orders', input] as const,
};
