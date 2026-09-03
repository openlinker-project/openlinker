import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRunLog } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * One rule's fired log, or `null` when the envelope could not be read.
 *
 * A consumer MUST branch on `recordingAvailable` before reading `runs`: while
 * it is false an empty log means the run write path has not landed, not that
 * the rule never fired.
 */
export function useAutomationRunsQuery(
  ruleId: string,
  enabled = true,
): UseQueryResult<AutomationRunLog | null> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: automationQueryKeys.runs(ruleId),
    queryFn: () => apiClient.automations.listRuns(ruleId),
    enabled,
  });
}
