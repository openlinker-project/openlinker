/**
 * The cross-rule activity feed (#2386)
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRunLog } from '../api/automation.types';
import type { AutomationActivityFilters } from '../lib/automation-activity-filters';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface AutomationRunFeedPagination {
  limit?: number;
  offset?: number;
}

export function useAutomationRunFeedQuery(
  filters: AutomationActivityFilters,
  pagination: AutomationRunFeedPagination = {},
): UseQueryResult<AutomationRunLog | null> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: automationQueryKeys.runFeed(filters, pagination),
    queryFn: () => apiClient.automations.listRunFeed(filters, pagination),
  });
}
