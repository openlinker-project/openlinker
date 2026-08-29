import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { ParsedAutomationRules } from '../api/automation.schema';
import type { AutomationTrigger } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * The rules on one trigger.
 *
 * The trigger is required, not optional — `GET /automations` answers 400
 * without it, so there is no "all rules" query to fall back to.
 *
 * `enabled` exists because a caller reading the trigger from a route param
 * cannot know it is valid until after the hooks have run. Without it, such a
 * caller must pass SOME member of the union to satisfy the type — and that
 * placeholder is then fetched for real and cached under a legitimate trigger's
 * key, pre-populating a page the operator never asked for.
 */
export function useAutomationRulesQuery(
  trigger: AutomationTrigger,
  enabled = true,
): UseQueryResult<ParsedAutomationRules> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: automationQueryKeys.list(trigger),
    queryFn: () => apiClient.automations.listByTrigger(trigger),
    enabled,
  });
}
