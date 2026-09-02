import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { ParsedAutomationSummary } from '../api/automation.schema';
import { useApiClient } from '../../../app/api/api-client-provider';

/** Rule counts for all eight triggers, zeros included. */
export function useAutomationSummaryQuery(): UseQueryResult<ParsedAutomationSummary> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: automationQueryKeys.summary(),
    queryFn: () => apiClient.automations.getSummary(),
  });
}
