import type { GetProductMatchingOrdersInput } from './analytics-matching-coverage.types';

export const analyticsMatchingCoverageQueryKeys = {
  all: ['analytics', 'matching-coverage'] as const,
  orders: (input: GetProductMatchingOrdersInput) =>
    ['analytics', 'matching-coverage', 'orders', input] as const,
};
