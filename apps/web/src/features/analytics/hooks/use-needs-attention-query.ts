/**
 * Needs Attention Query Hook
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { needsAttentionQueryKeys } from '../api/needs-attention.query-keys';
import type { NeedsAttentionSummary } from '../api/needs-attention.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useNeedsAttentionQuery(): UseQueryResult<NeedsAttentionSummary> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: needsAttentionQueryKeys.summary(),
    queryFn: () => apiClient.analyticsTrust.getNeedsAttention(),
  });
}
