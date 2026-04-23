/**
 * Prompt Template Detail Query Hook
 *
 * Fetches a single template by id for the detail / editor page.
 *
 * @module apps/web/src/features/prompt-templates/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { promptTemplatesQueryKeys } from '../api/prompt-templates.query-keys';
import type { PromptTemplate } from '../api/prompt-templates.types';

export function usePromptTemplateQuery(
  id: string | undefined,
): UseQueryResult<PromptTemplate> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: promptTemplatesQueryKeys.detail(id ?? ''),
    queryFn: () => apiClient.promptTemplates.get(id as string),
    enabled: typeof id === 'string' && id.length > 0,
  });
}
