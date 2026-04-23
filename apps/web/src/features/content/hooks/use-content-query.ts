/**
 * Content Query Hook
 *
 * Fetches master + channel content state for a product.
 *
 * @module apps/web/src/features/content/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { contentQueryKeys } from '../api/content.query-keys';
import type { ContentState } from '../api/content.types';

export function useContentQuery(productId: string | undefined): UseQueryResult<ContentState> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: contentQueryKeys.forProduct(productId ?? ''),
    queryFn: () => apiClient.content.get(productId as string),
    enabled: typeof productId === 'string' && productId.length > 0,
  });
}
