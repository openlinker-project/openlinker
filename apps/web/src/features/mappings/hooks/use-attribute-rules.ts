/**
 * Attribute Mapping Rules Hooks
 *
 * TanStack Query hooks for listing, upserting, and deleting operator-authored
 * attribute mapping rules (#1841).
 *
 * @module apps/web/src/features/mappings/hooks
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { AttributeRule, UpsertAttributeRulePayload } from '../api/mappings.types';

export function useAttributeRulesQuery(connectionId: string): UseQueryResult<AttributeRule[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: mappingsQueryKeys.attributeRules(connectionId),
    queryFn: () => apiClient.mappings.getAttributeRules(connectionId),
  });
}

export function useUpsertAttributeRule(
  connectionId: string
): UseMutationResult<AttributeRule, Error, UpsertAttributeRulePayload> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpsertAttributeRulePayload) =>
      apiClient.mappings.upsertAttributeRule(connectionId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mappingsQueryKeys.attributeRules(connectionId),
      });
    },
  });
}

export function useDeleteAttributeRule(
  connectionId: string
): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => apiClient.mappings.deleteAttributeRule(connectionId, ruleId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: mappingsQueryKeys.attributeRules(connectionId),
      });
    },
  });
}
