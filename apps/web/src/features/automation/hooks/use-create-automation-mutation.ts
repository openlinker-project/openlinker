/**
 * Create one rule (#2365)
 *
 * Invalidates the list AND the summary, for the reason the arm/disarm mutation
 * already documents: the index's per-trigger count is derived from the rows this
 * write touches, so invalidating only the list leaves a stale count one route up
 * — which is exactly where the operator goes next after saving.
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRule, AutomationRuleWriteInput } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useCreateAutomationMutation(): UseMutationResult<
  AutomationRule,
  Error,
  AutomationRuleWriteInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AutomationRuleWriteInput) => apiClient.automations.create(input),
    onSuccess: (_result, input) => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.list(input.trigger) });
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.summary() });
    },
  });
}
