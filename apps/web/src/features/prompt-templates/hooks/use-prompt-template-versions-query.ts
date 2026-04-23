/**
 * Prompt Template Versions Query Hook
 *
 * Feeds the version-history `Timeline` on the detail page.
 *
 * @module apps/web/src/features/prompt-templates/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { promptTemplatesQueryKeys } from '../api/prompt-templates.query-keys';
import type { PromptTemplate, PromptTemplateChannel } from '../api/prompt-templates.types';

export function usePromptTemplateVersionsQuery(
  key: string | undefined,
  channel: PromptTemplateChannel | null | undefined,
): UseQueryResult<PromptTemplate[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: promptTemplatesQueryKeys.versions(key ?? '', channel ?? null),
    queryFn: () => apiClient.promptTemplates.getVersions(key as string, channel ?? null),
    enabled: typeof key === 'string' && key.length > 0 && channel !== undefined,
  });
}
