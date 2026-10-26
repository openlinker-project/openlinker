/**
 * Stock located at the warehouse (#3457, step 1)
 *
 * How much of the product masters' stock already sits at `MAIN`: rows at the
 * location against all rows. Both are `limit: 1` reads that only use `total`.
 *
 * The override is applied by the NEXT master inventory sync, not instantly,
 * so right after Confirm the located count can sit at 0 for a sync cycle. The
 * hook therefore polls — but only while it is still filling in, and TanStack
 * pauses the interval while the tab is hidden.
 *
 * @module features/oms-onboarding/hooks
 */
import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../../inventory';
import { STOCK_PROGRESS_POLL_MS } from '../lib/oms-onboarding.constants';

export interface StockLocatedProgress {
  readonly located: number;
  readonly total: number;
  /** `total > 0 && located >= total`. Nothing to locate is not "complete". */
  readonly complete: boolean;
  readonly isLoading: boolean;
}

const ONE = { limit: 1 } as const;
// Stale rows are products the master no longer reports; no sync will ever
// locate them, so counting them would leave the progress short for good.
const LIVE = { excludeStale: true } as const;

export function useStockLocatedProgress(mainLocationId: string | null): StockLocatedProgress {
  const apiClient = useApiClient();
  const enabled = mainLocationId !== null;
  const locatedFilters = { locationId: mainLocationId ?? '', ...LIVE };

  const totalQuery = useQuery({
    queryKey: inventoryQueryKeys.list(LIVE, ONE),
    queryFn: () => apiClient.inventory.list(LIVE, ONE),
    enabled,
  });

  const total = totalQuery.data?.total ?? 0;

  const locatedQuery = useQuery({
    queryKey: inventoryQueryKeys.list(locatedFilters, ONE),
    queryFn: () => apiClient.inventory.list(locatedFilters, ONE),
    enabled,
    refetchInterval: (query) => {
      const located = query.state.data?.total ?? 0;
      return total === 0 || located < total ? STOCK_PROGRESS_POLL_MS : false;
    },
  });

  const located = Math.min(locatedQuery.data?.total ?? 0, total);

  return {
    located,
    total,
    complete: total > 0 && located >= total,
    isLoading: enabled && (totalQuery.isLoading || locatedQuery.isLoading),
  };
}
