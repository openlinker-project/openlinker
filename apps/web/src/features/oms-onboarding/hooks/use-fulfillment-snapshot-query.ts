/**
 * Fulfilment snapshot (#3457, the status page and the first-order view)
 *
 * How many tasks are on Fulfilment and which one arrived last.
 *
 * `GET /fulfillment/works` lists OLDEST first, so the newest task is the one
 * at `offset = total - 1`: one `limit: 1` read for the total, then a second
 * for that row. Two small reads beat pulling a whole page to look at its end.
 *
 * There is no assignee filter on that endpoint, so the mockup's "4 unassigned"
 * is not shown rather than computed from a partial page.
 *
 * @module features/oms-onboarding/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { FulfillmentTask } from '../../fulfillment';
import { omsOnboardingQueryKeys } from '../api/oms-onboarding.query-keys';

export interface FulfillmentSnapshot {
  readonly total: number;
  readonly newest: FulfillmentTask | null;
}

export function useFulfillmentSnapshotQuery(options: {
  readonly enabled: boolean;
  readonly refetchIntervalMs: number | false;
}): UseQueryResult<FulfillmentSnapshot> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: omsOnboardingQueryKeys.fulfillmentSnapshot(),
    queryFn: async (): Promise<FulfillmentSnapshot> => {
      const head = await apiClient.fulfillment.list({ limit: 1 });
      if (head.total === 0) return { total: 0, newest: null };
      if (head.total === 1) return { total: 1, newest: head.works[0] ?? null };
      const tail = await apiClient.fulfillment.list({ limit: 1, offset: head.total - 1 });
      return { total: head.total, newest: tail.works[0] ?? null };
    },
    enabled: options.enabled,
    refetchInterval: options.refetchIntervalMs,
  });
}
