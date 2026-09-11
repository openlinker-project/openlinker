/**
 * useSetSourceSyncModeMutation (#3148)
 *
 * The "also set to Automatic" opt-in's underlying write, and its Undo. A
 * read-modify-write against `GET`/`PATCH /connections/:id/pricing-sync`
 * (#3146) — preserves every other source's effective setting, touching only
 * the one (destination, source) pair's mode.
 *
 * @module apps/web/src/features/price-changes/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { PriceSyncMode } from '../api/price-changes.types';
import type { PricingSyncSetting } from '../api/pricing-sync.types';

export interface SetSourceSyncModeInput {
  destinationConnectionId: string;
  sourceConnectionId: string;
  mode: PriceSyncMode;
}

export function useSetSourceSyncModeMutation(): UseMutationResult<
  void,
  Error,
  SetSourceSyncModeInput
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: async ({ destinationConnectionId, sourceConnectionId, mode }) => {
      const view = await apiClient.pricingSync.get(destinationConnectionId);
      const sourceOverrides: Record<string, PricingSyncSetting> = {};
      for (const source of view.sources) {
        sourceOverrides[source.sourceConnectionId] = source.effective;
      }
      const currentRule =
        sourceOverrides[sourceConnectionId]?.rule ?? view.default.rule;
      sourceOverrides[sourceConnectionId] = { mode, rule: currentRule };
      await apiClient.pricingSync.update(destinationConnectionId, {
        default: view.default,
        sourceOverrides,
      });
    },
  });
}
