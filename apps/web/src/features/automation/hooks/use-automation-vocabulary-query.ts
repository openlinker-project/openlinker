import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationVocabulary } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * The closed vocabulary and the legality matrix.
 *
 * Long-lived: it is a build constant, not operator data — it changes only when
 * OpenLinker is upgraded. Fetched once per session rather than per screen so
 * the index panel and every trigger page read the same answer.
 */
export function useAutomationVocabularyQuery(): UseQueryResult<AutomationVocabulary> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: automationQueryKeys.vocabulary(),
    queryFn: () => apiClient.automations.getVocabulary(),
    staleTime: 60 * 60 * 1000,
  });
}
