/**
 * Prompt Templates List Query Hook
 *
 * Drives the admin list view. Returns one summary per `(key, channel)` pair.
 *
 * @module apps/web/src/features/prompt-templates/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { promptTemplatesQueryKeys } from '../api/prompt-templates.query-keys';
import type {
  PromptTemplateListFilters,
  PromptTemplateSummary,
} from '../api/prompt-templates.types';

export function usePromptTemplatesQuery(
  filters?: PromptTemplateListFilters,
): UseQueryResult<PromptTemplateSummary[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: promptTemplatesQueryKeys.list(filters),
    queryFn: () => apiClient.promptTemplates.list(filters),
  });
}
