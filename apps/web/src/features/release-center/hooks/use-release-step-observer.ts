/**
 * Step completion observer (#4146, ADR-085)
 *
 * Watches the `MutationCache` for successful saves whose `mutationKey` a step
 * declares, so `features/connections` and `features/mappings` never import the
 * release center. On mutation start it snapshots the connection from the query
 * cache (the value before the save), and on success it asks `completedStepItemKeys`
 * which steps that save completed and writes them `done` / `auto`.
 *
 * Only writers whose hook sets a `mutationKey` are observed
 * (`useUpdateConnectionMutation`, the routing-rules mutation). Others are not,
 * by design. Admins only: operator and viewer saves issue no request.
 *
 * Mount once, inside the authenticated layout, via `<ReleaseStepObserver />`.
 *
 * @module features/release-center/hooks
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { APP_VERSION } from '../../../shared/config/app-version';
import { RELEASE_STEPS } from '../catalog/release-steps';
import type { ReleaseStepConnection } from '../catalog/release-step.types';
import { completedStepItemKeys, connectionIdOf } from '../lib/completed-steps';
import { installationStatusOf } from '../lib/release-state-merge';
import { releaseStateQueryKeys } from '../api/release-state.query-keys';
import type { ReleaseState } from '../api/release-state.types';
import { useReleaseCenterAccess } from './use-release-center-access';
import { useReleaseStepsMutation } from './use-release-steps-mutation';

interface CachedConnection {
  id: string;
  platformType: string;
  enabledCapabilities: string[];
  config: Record<string, unknown>;
}

function findConnection(
  queryClient: ReturnType<typeof useQueryClient>,
  connectionId: string
): ReleaseStepConnection | undefined {
  const toStep = (c: CachedConnection): ReleaseStepConnection => ({
    id: c.id,
    platformType: c.platformType,
    capabilities: c.enabledCapabilities,
    config: c.config,
  });
  const detail = queryClient.getQueryData<CachedConnection>(['connections', 'detail', connectionId]);
  if (detail) return toStep(detail);
  const lists = queryClient.getQueriesData<CachedConnection[]>({
    queryKey: ['connections', 'list'],
  });
  for (const [, rows] of lists) {
    const hit = rows?.find((row) => row.id === connectionId);
    if (hit) return toStep(hit);
  }
  return undefined;
}

export function useReleaseStepObserver(): void {
  const queryClient = useQueryClient();
  const { canWriteSteps } = useReleaseCenterAccess();
  const { mutate } = useReleaseStepsMutation();

  useEffect(() => {
    if (!canWriteSteps) return undefined;
    const before = new Map<number, ReleaseStepConnection | undefined>();
    const cache = queryClient.getMutationCache();

    return cache.subscribe((event) => {
      if (event.type !== 'updated') return;
      const { mutation, action } = event;
      const key = mutation.options.mutationKey;
      if (!key) return;
      const id = mutation.mutationId;

      if (action.type === 'pending') {
        const connectionId = connectionIdOf(action.variables, mutation.meta);
        before.set(id, connectionId ? findConnection(queryClient, connectionId) : undefined);
        return;
      }
      if (action.type === 'error') {
        before.delete(id);
        return;
      }
      if (action.type !== 'success') return;

      const snapshot = before.get(id);
      before.delete(id);
      const keys = completedStepItemKeys(
        {
          mutationKey: key,
          variables: mutation.state.variables,
          meta: mutation.meta,
          before: snapshot,
        },
        RELEASE_STEPS,
        APP_VERSION
      );
      if (keys.length === 0) return;
      const state = queryClient.getQueryData<ReleaseState>(releaseStateQueryKeys.state());
      const pending = keys.filter((itemKey) => installationStatusOf(state, itemKey) !== 'done');
      if (pending.length === 0) return;
      mutate(pending.map((itemKey) => ({ itemKey, status: 'done' as const, doneVia: 'auto' as const })));
    });
  }, [canWriteSteps, mutate, queryClient]);
}
