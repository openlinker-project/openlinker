/**
 * Delete one rule (#2364)
 *
 * Invalidates the list AND the summary for the same reason the arm/disarm
 * mutation does — the index count is derived from these rows.
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRule } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useDeleteAutomationMutation(): UseMutationResult<void, Error, AutomationRule> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (rule: AutomationRule) => apiClient.automations.remove(rule.id),
    onSuccess: (_result, rule) => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.list(rule.trigger) });
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.summary() });
    },
  });
}
