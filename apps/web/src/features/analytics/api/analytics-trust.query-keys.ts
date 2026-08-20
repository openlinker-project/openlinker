/**
 * Analytics Trust Query Keys
 *
 * @module apps/web/src/features/analytics/api
 */

export const analyticsTrustQueryKeys = {
  all: ['analytics-trust'] as const,
  snapshot: () => ['analytics-trust', 'snapshot'] as const,
};
