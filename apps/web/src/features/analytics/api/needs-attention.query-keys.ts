/**
 * Needs Attention Query Keys
 *
 * @module apps/web/src/features/analytics/api
 */

export const needsAttentionQueryKeys = {
  all: ['needs-attention'] as const,
  summary: () => ['needs-attention', 'summary'] as const,
};
