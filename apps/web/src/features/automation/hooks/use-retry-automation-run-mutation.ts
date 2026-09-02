/**
 * Re-run one failed firing (#2387)
 *
 * Invalidates **every** run-shaped key, not just the one the caller is looking
 * at: a retry writes a NEW run row and changes the ORIGINAL row's derived
 * attention state, so the per-rule log, the activity feed, the order timeline
 * and the attention count are all stale afterwards. Invalidating only the
 * visible list is how a cleared failure keeps its badge on the next screen.
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRun } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useRetryAutomationRunMutation(): UseMutationResult<AutomationRun, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: string) => apiClient.automations.retryRun(runId),
    onSuccess: () => {
      // `automationQueryKeys.all` covers every run listing and the count. A
      // narrower set would need updating each time a surface is added, and the
      // failure mode of forgetting is a stale attention badge.
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.all });
    },
  });
}
