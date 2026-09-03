/**
 * usePresetPreviewQuery
 *
 * What an arrangement would change (`POST /fulfillment-authority/presets/preview`).
 *
 * **A read, not a mutation, and that is structural rather than stylistic.** The
 * endpoint commits nothing, and modelling the dry run as a `useQuery` keeps it
 * on a different seam from the apply — so no refactor can accidentally make
 * "show me what this would do" write something. A test asserts that opening and
 * cancelling the dialog never calls `applyPreset`.
 *
 * Disabled until the dialog is actually open: merely selecting an arrangement
 * must not fire a request, since the operator has not asked a question yet.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { whoDecidesQueryKeys } from '../api/who-decides.query-keys';
import type { AuthorityPresetId, AuthorityPresetPreview } from '../api/who-decides.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function usePresetPreviewQuery(
  presetId: AuthorityPresetId | null,
  enabled: boolean,
): UseQueryResult<AuthorityPresetPreview | null> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: whoDecidesQueryKeys.preview(presetId ?? ''),
    // Narrowed rather than cast: `enabled` already gates on the same value, but
    // a cast would make that gate load-bearing for type safety instead of for
    // behaviour, and the two drift the moment someone reuses the hook.
    queryFn: () =>
      presetId === null
        ? Promise.resolve(null)
        : apiClient.fulfillmentAuthority.previewPreset(presetId),
    enabled: enabled && presetId !== null,
  });
}
