/**
 * use-description-format-query (ADR-046)
 *
 * Loads the destination's declared description contract so `RichTextEditor` can
 * compose itself from it. This hook is what keeps destination knowledge out of
 * the frontend: without it the editor would need a per-marketplace table, which
 * is the alternative ADR-046 rejects.
 *
 * A declaration is a pure adapter method - no live platform call, no per-seller
 * state - so it is effectively static for the lifetime of a session. Cached for
 * an hour, matching `use-shop-attributes-query`'s reasoning for the same shape
 * of data.
 *
 * The query never errors for an unknown or disabled connection: the endpoint
 * returns the conservative fallback with `declared: false` instead, because an
 * editor has nothing useful to do with that error and a dead field is worse than
 * a restricted one.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { DescriptionFormat } from '../../../shared/ui/rich-text.types';

export const DESCRIPTION_FORMAT_STALE_TIME_MS = 60 * 60 * 1000;

export function useDescriptionFormatQuery(
  connectionId: string | null | undefined,
  enabled = true,
): UseQueryResult<DescriptionFormat> {
  const apiClient = useApiClient();

  return useQuery<DescriptionFormat>({
    queryKey: listingsQueryKeys.descriptionFormat(connectionId ?? ''),
    queryFn: () => apiClient.listings.getDescriptionFormat(connectionId ?? ''),
    enabled: enabled && Boolean(connectionId),
    staleTime: DESCRIPTION_FORMAT_STALE_TIME_MS,
  });
}
