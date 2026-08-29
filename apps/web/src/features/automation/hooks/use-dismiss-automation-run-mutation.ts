/**
 * Record that a person handled a failed firing themselves (#2387)
 *
 * The run stays `failed` and its history is untouched — only the attention
 * state clears. Invalidates every run-shaped key for the same reason the retry
 * mutation does: the count and four listings all read the row that changed.
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRun } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useDismissAutomationRunMutation(): UseMutationResult<AutomationRun, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: string) => apiClient.automations.dismissRun(runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.all });
    },
  });
}
