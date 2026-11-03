/**
 * Fulfillment Routing Hooks (#836)
 *
 * Server-state hooks for the routing-config panel: the persisted rules, the
 * compatible processor candidates, and the replace-all mutation. Mirrors
 * `use-carrier-mappings`.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import {
  useQueries,
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type {
  RoutingRule,
  CandidateProcessor,
  UpsertRoutingRulesPayload,
} from '../api/mappings.types';

export function useRoutingRulesQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<RoutingRule[]> {
  const apiClient = useApiClient();
  return useQuery({
    // Caller may gate further (e.g. only for OrderSource connections); the
    // connectionId guard always applies.
    enabled: connectionId.length > 0 && (options?.enabled ?? true),
    queryKey: mappingsQueryKeys.routingRules(connectionId),
    queryFn: () => apiClient.mappings.getRoutingRules(connectionId),
  });
}

export function useRoutingCandidatesQuery(
  connectionId: string,
): UseQueryResult<CandidateProcessor[]> {
  const apiClient = useApiClient();
  return useQuery({
    enabled: connectionId.length > 0,
    queryKey: mappingsQueryKeys.routingCandidates(connectionId),
    queryFn: () => apiClient.mappings.getRoutingCandidates(connectionId),
  });
}

export function useReplaceRoutingRules(
  connectionId: string,
): UseMutationResult<RoutingRule[], Error, UpsertRoutingRulesPayload> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertRoutingRulesPayload) =>
      apiClient.mappings.replaceRoutingRules(connectionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mappingsQueryKeys.routingRules(connectionId),
      });
    },
  });
}

/**
 * Routing rules for several source connections at once (#3652) - the bulk
 * dispatch dialog spans sources and needs each order's rule for its parcel
 * profile. Same query keys as `useRoutingRulesQuery`, so single- and
 * multi-source callers share one cache entry per connection.
 */
export function useRoutingRulesForConnections(
  connectionIds: readonly string[],
  options?: { enabled?: boolean },
): Map<string, RoutingRule[]> {
  const apiClient = useApiClient();
  const enabled = options?.enabled ?? true;
  const results = useQueries({
    queries: connectionIds.map((connectionId) => ({
      enabled: enabled && connectionId.length > 0,
      queryKey: mappingsQueryKeys.routingRules(connectionId),
      queryFn: () => apiClient.mappings.getRoutingRules(connectionId),
    })),
  });
  const map = new Map<string, RoutingRule[]>();
  connectionIds.forEach((id, index) => {
    const data = results[index]?.data;
    if (data) map.set(id, data);
  });
  return map;
}
