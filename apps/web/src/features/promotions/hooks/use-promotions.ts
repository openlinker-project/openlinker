/**
 * Gift rules - query and mutation hooks (#3940)
 *
 * @module apps/web/src/features/gifts/hooks
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
import { giftsQueryKeys } from '../api/gifts.query-keys';
import type {
  AddGiftInput,
  AddGiftResult,
  GiftAttentionEntry,
  GiftAttentionResult,
  GiftDryRunResult,
  GiftEvaluateInput,
  GiftRule,
  GiftRuleWriteInput,
} from '../api/gifts.types';

export function useGiftRulesQuery(): UseQueryResult<GiftRule[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: giftsQueryKeys.rules(),
    queryFn: () => apiClient.gifts.listRules(),
  });
}

export function useGiftRuleQuery(ruleId: string | null): UseQueryResult<GiftRule> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: [...giftsQueryKeys.rules(), 'one', ruleId ?? ''],
    queryFn: () => apiClient.gifts.getRule(ruleId ?? ''),
    enabled: ruleId !== null,
  });
}

function useInvalidateRules(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: giftsQueryKeys.all });
  };
}

export function useSaveGiftRuleMutation(): UseMutationResult<
  GiftRule,
  ApiError,
  { ruleId: string | null; input: GiftRuleWriteInput }
> {
  const apiClient = useApiClient();
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: ({ ruleId, input }) =>
      ruleId === null ? apiClient.gifts.createRule(input) : apiClient.gifts.replaceRule(ruleId, input),
    onSuccess: invalidate,
  });
}

export function useReorderGiftRulesMutation(): UseMutationResult<GiftRule[], ApiError, string[]> {
  const apiClient = useApiClient();
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (ruleIds) => apiClient.gifts.reorderRules(ruleIds),
    onSuccess: invalidate,
  });
}

export function useResumeGiftRuleMutation(): UseMutationResult<
  GiftRule,
  ApiError,
  { ruleId: string; additionalUnits: number }
> {
  const apiClient = useApiClient();
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: ({ ruleId, additionalUnits }) => apiClient.gifts.resumeRule(ruleId, additionalUnits),
    onSuccess: invalidate,
  });
}

export function useDeleteGiftRuleMutation(): UseMutationResult<void, ApiError, string> {
  const apiClient = useApiClient();
  const invalidate = useInvalidateRules();
  return useMutation({
    mutationFn: (ruleId) => apiClient.gifts.deleteRule(ruleId),
    onSuccess: invalidate,
  });
}

export function useEvaluateGiftRulesMutation(): UseMutationResult<
  GiftDryRunResult,
  ApiError,
  GiftEvaluateInput
> {
  const apiClient = useApiClient();
  return useMutation({ mutationFn: (input) => apiClient.gifts.evaluate(input) });
}

export function useAddGiftMutation(
  internalOrderId: string,
): UseMutationResult<AddGiftResult, ApiError, AddGiftInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.gifts.addGiftToOrder(internalOrderId, input),
    onSuccess: (result) => {
      if (result.dryRun) return;
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: giftsQueryKeys.all });
    },
  });
}

export function useGiftAttentionQuery(internalOrderId: string): UseQueryResult<GiftAttentionResult> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: giftsQueryKeys.attention(internalOrderId),
    queryFn: () => apiClient.gifts.getGiftAttention(internalOrderId),
    enabled: internalOrderId.length > 0,
  });
}

export function useSkipGiftAttentionMutation(
  internalOrderId: string,
): UseMutationResult<GiftAttentionEntry, ApiError, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => apiClient.gifts.skipGiftAttention(internalOrderId, runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: giftsQueryKeys.attention(internalOrderId) });
    },
  });
}
