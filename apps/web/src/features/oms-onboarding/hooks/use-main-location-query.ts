/**
 * The warehouse packing uses (#3457)
 *
 * Reads the `MAIN` location the step-1 Confirm creates, or `null` while it
 * does not exist. A read only — creating it is the operator's click, never a
 * side effect of opening the page (#2407).
 *
 * Keyed under the shared locations family so the bootstrap mutation's
 * invalidation refreshes it.
 *
 * @module features/oms-onboarding/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys, type InventoryLocation } from '../../inventory';
import { MAIN_LOCATION_CODE } from '../lib/oms-onboarding.constants';

const FILTERS = { codePrefix: MAIN_LOCATION_CODE } as const;
const PAGINATION = { limit: 50 } as const;

export function useMainLocationQuery(): UseQueryResult<InventoryLocation | null> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.locations(FILTERS, PAGINATION),
    queryFn: async () => {
      const page = await apiClient.inventory.listLocations(FILTERS, PAGINATION);
      // `codePrefix` also matches `MAIN2`; only the exact code is ours.
      return page.items.find((location) => location.code === MAIN_LOCATION_CODE) ?? null;
    },
  });
}
