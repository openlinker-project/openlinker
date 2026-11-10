/**
 * Promotions - query and mutation hooks (#3935)
 *
 * @module apps/web/src/features/promotions/hooks
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';
import { promotionsQueryKeys } from '../api/promotions.query-keys';
import type {
  Promotion,
  PromotionDryRunResult,
  PromotionEvaluateInput,
  PromotionHistory,
  PromotionWriteInput,
} from '../api/promotions.types';

export function usePromotionsQuery(): UseQueryResult<Promotion[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: promotionsQueryKeys.list(),
    queryFn: () => apiClient.promotions.list(),
  });
}

export function usePromotionQuery(id: string | null): UseQueryResult<Promotion> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: promotionsQueryKeys.one(id ?? ''),
    queryFn: () => apiClient.promotions.get(id ?? ''),
    enabled: id !== null,
  });
}

export function usePromotionHistoryQuery(id: string, enabled: boolean): UseQueryResult<PromotionHistory> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: promotionsQueryKeys.history(id),
    queryFn: () => apiClient.promotions.history(id),
    enabled,
  });
}

function useInvalidatePromotions(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: promotionsQueryKeys.all });
  };
}

export function useSavePromotionMutation(): UseMutationResult<
  Promotion,
  ApiError,
  { id: string | null; input: PromotionWriteInput }
> {
  const apiClient = useApiClient();
  const invalidate = useInvalidatePromotions();
  return useMutation({
    mutationFn: ({ id, input }) =>
      id === null ? apiClient.promotions.create(input) : apiClient.promotions.replace(id, input),
    onSuccess: invalidate,
  });
}

export function useReorderPromotionsMutation(): UseMutationResult<Promotion[], ApiError, string[]> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids) => apiClient.promotions.reorder(ids),
    onSuccess: (rows) => {
      queryClient.setQueryData(promotionsQueryKeys.list(), rows);
      void queryClient.invalidateQueries({ queryKey: promotionsQueryKeys.all });
    },
  });
}

export function useResumePromotionMutation(): UseMutationResult<
  Promotion,
  ApiError,
  { id: string; additionalUnits: number }
> {
  const apiClient = useApiClient();
  const invalidate = useInvalidatePromotions();
  return useMutation({
    mutationFn: ({ id, additionalUnits }) => apiClient.promotions.resume(id, additionalUnits),
    onSuccess: invalidate,
  });
}

export function useDeletePromotionMutation(): UseMutationResult<void, ApiError, string> {
  const apiClient = useApiClient();
  const invalidate = useInvalidatePromotions();
  return useMutation({
    mutationFn: (id) => apiClient.promotions.remove(id),
    onSuccess: invalidate,
  });
}

export function useEvaluatePromotionsMutation(): UseMutationResult<
  PromotionDryRunResult,
  ApiError,
  PromotionEvaluateInput
> {
  const apiClient = useApiClient();
  return useMutation({ mutationFn: (input) => apiClient.promotions.evaluate(input) });
}
