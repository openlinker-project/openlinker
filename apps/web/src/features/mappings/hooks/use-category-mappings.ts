/**
 * Category Mappings Hooks
 *
 * TanStack Query hooks for category mapping CRUD operations. A mapping is
 * keyed by the MARKETPLACE connection it is for and scoped to the master that
 * owns the source category (#3993) - that pair is what offer creation reads.
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
import type {
  CategoryMapping,
  CategoryMappingReassignResult,
  UpsertCategoryMappingPayload,
} from '../api/mappings.types';

/**
 * Mappings saved under `connectionId`. With `sourceConnectionId`, only those
 * that apply to that master; without it, every row under the connection.
 */
export function useCategoryMappingsQuery(
  connectionId: string,
  sourceConnectionId?: string,
  enabled = true,
): UseQueryResult<CategoryMapping[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: mappingsQueryKeys.categories(connectionId, sourceConnectionId),
    queryFn: () => apiClient.mappings.getCategoryMappings(connectionId, sourceConnectionId),
    enabled: enabled && connectionId !== '',
  });
}

function invalidateCategoryMappings(
  queryClient: ReturnType<typeof useQueryClient>,
  connectionId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: ['mappings', connectionId, 'categories'] });
}

export function useUpsertCategoryMapping(
  marketplaceConnectionId: string,
  sourceConnectionId: string,
): UseMutationResult<
  CategoryMapping,
  Error,
  { prestashopCategoryId: string; payload: Omit<UpsertCategoryMappingPayload, 'sourceConnectionId'> }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ prestashopCategoryId, payload }) =>
      apiClient.mappings.upsertCategoryMapping(marketplaceConnectionId, prestashopCategoryId, {
        ...payload,
        sourceConnectionId,
      }),
    onSuccess: () => {
      invalidateCategoryMappings(queryClient, marketplaceConnectionId);
    },
  });
}

export function useDeleteCategoryMapping(
  marketplaceConnectionId: string,
  sourceConnectionId: string,
): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prestashopCategoryId: string) =>
      apiClient.mappings.deleteCategoryMapping(
        marketplaceConnectionId,
        prestashopCategoryId,
        sourceConnectionId,
      ),
    onSuccess: () => {
      invalidateCategoryMappings(queryClient, marketplaceConnectionId);
    },
  });
}

/**
 * Move the mappings saved under `fromConnectionId` (the master, before #3993)
 * onto the marketplace. Both connections' lists refresh afterwards.
 */
export function useReassignCategoryMappings(
  marketplaceConnectionId: string,
): UseMutationResult<CategoryMappingReassignResult, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (fromConnectionId: string) =>
      apiClient.mappings.reassignCategoryMappings(marketplaceConnectionId, fromConnectionId),
    onSuccess: (_result, fromConnectionId) => {
      invalidateCategoryMappings(queryClient, marketplaceConnectionId);
      invalidateCategoryMappings(queryClient, fromConnectionId);
    },
  });
}
