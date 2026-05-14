/**
 * Category Mappings Hooks
 *
 * TanStack Query hooks for category mapping CRUD operations.
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
import type { CategoryMapping, UpsertCategoryMappingPayload } from '../api/mappings.types';

export function useCategoryMappingsQuery(connectionId: string): UseQueryResult<CategoryMapping[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: mappingsQueryKeys.categories(connectionId),
    queryFn: () => apiClient.mappings.getCategoryMappings(connectionId),
  });
}

export function useUpsertCategoryMapping(
  connectionId: string
): UseMutationResult<
  CategoryMapping,
  Error,
  { prestashopCategoryId: string; payload: UpsertCategoryMappingPayload }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ prestashopCategoryId, payload }) =>
      apiClient.mappings.upsertCategoryMapping(connectionId, prestashopCategoryId, payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mappingsQueryKeys.categories(connectionId) });
    },
  });
}

export function useDeleteCategoryMapping(
  connectionId: string
): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prestashopCategoryId: string) =>
      apiClient.mappings.deleteCategoryMapping(connectionId, prestashopCategoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: mappingsQueryKeys.categories(connectionId) });
    },
  });
}
