/**
 * One subject's automation firings (#2385)
 *
 * The order timeline's source — the same `automation_runs` rows the per-rule log
 * and the activity list read, filtered by subject.
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRunLog } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useSubjectAutomationRunsQuery(
  subjectKind: string,
  subjectId: string,
  enabled = true,
): UseQueryResult<AutomationRunLog | null> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: automationQueryKeys.runsBySubject(subjectKind, subjectId),
    queryFn: () => apiClient.automations.listRunsBySubject(subjectKind, subjectId),
    enabled: enabled && subjectId.length > 0,
  });
}
