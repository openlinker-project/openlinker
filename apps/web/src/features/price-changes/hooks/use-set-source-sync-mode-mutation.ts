/**
 * useSetSourceSyncModeMutation (#3148)
 *
 * The "also set to Automatic" opt-in's underlying write, and its Undo. A
 * read-modify-write against `GET`/`PATCH /connections/:id/pricing-sync`
 * (#3146) — preserves every other source's *explicit* override, touching
 * only the one (destination, source) pair's mode.
 *
 * **"Preserves" means "re-sends only what was already an override" (#3148
 * review, finding 1).** `ConnectionPricingSyncView.sources[].effective` is
 * the RESOLVED value (override-then-default), not "this source carries an
 * override" — `isCustomOverride` is the field that distinguishes the two.
 * `PATCH` is a full explicit-Save write (no partial patch), so seeding
 * `sourceOverrides` from every entry's `effective` value — as an earlier
 * revision did — stamps an explicit override onto every source that was
 * merely INHERITING the destination's default, including every one of the
 * connection's other open episodes. A later change to the destination's
 * default rule would then silently stop reaching any of them. Only rows
 * that already carry `isCustomOverride: true` are re-sent verbatim; the one
 * pair actually being changed is then set (or added) on top.
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
        if (source.isCustomOverride) {
          sourceOverrides[source.sourceConnectionId] = source.effective;
        }
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
