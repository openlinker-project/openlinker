/**
 * useApplyPresetMutation
 *
 * Applies an arrangement (`PUT /fulfillment-authority/presets`, admin only).
 *
 * **Invalidation, never a cache seed.** The apply response does carry a full
 * status, but it is the status the SERVER computed at write time, and the write
 * is N independent saves that may partially fail. Seeding the cache from it
 * would make the table state what the write attempted rather than what the
 * connections now hold. The mutation result is still read by the caller — but
 * only for `applied`, which is a report about the attempt and exists nowhere
 * else.
 *
 * `onSettled`, not `onSuccess`: a partially-applied write rejects nothing, and a
 * 422 refusal writes nothing, but a failed request in between those two cases
 * can legitimately have moved some connections. Re-reading either way is the
 * only rendering that states the result rather than the intent.
 *
 * @module apps/web/src/features/fulfillment-authority/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { whoDecidesQueryKeys } from '../api/who-decides.query-keys';
import type { AuthorityPresetId, AuthorityStatus } from '../api/who-decides.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useApplyPresetMutation(): UseMutationResult<
  AuthorityStatus | null,
  Error,
  AuthorityPresetId
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation<AuthorityStatus | null, Error, AuthorityPresetId>({
    mutationFn: (presetId) => apiClient.fulfillmentAuthority.applyPreset(presetId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: whoDecidesQueryKeys.all });
    },
  });
}
