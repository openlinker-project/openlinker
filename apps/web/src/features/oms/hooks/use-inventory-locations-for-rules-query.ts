/**
 * Locations the sourcing-rules screen may rank (#3060)
 *
 * A `features/oms` hook over the inventory API rather than an inventory one,
 * because the shape it returns is this screen's: the picker's option, not an
 * `InventoryLocation` row.
 *
 * ## It lists EVERY status, not just active ones
 *
 * An inactive location is a legitimate priority entry — it may still be
 * outranked into irrelevance, and an operator retiring one should not silently
 * lose its place in a ruleset. The picker marks it instead. The page's
 * enablement gate is a different question and asks about ACTIVE locations only,
 * because a ruleset that can only rank retired warehouses decides nothing.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import type { SourcingRuleLocationOption } from '../components/sourcing-rule-dialog';

/** One page is enough for a picker; a ruleset ranking hundreds is not a shape this screen serves. */
export const SOURCING_RULE_LOCATION_PAGE_SIZE = 200;

export const sourcingRuleLocationsQueryKey = ['oms', 'sourcing-rules', 'locations'] as const;

export function useInventoryLocationsForRulesQuery(): UseQueryResult<SourcingRuleLocationOption[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: sourcingRuleLocationsQueryKey,
    queryFn: async () => {
      const page = await apiClient.inventory.listLocations(undefined, {
        limit: SOURCING_RULE_LOCATION_PAGE_SIZE,
      });
      return page.items.map((location) => ({
        id: location.id,
        code: location.code,
        name: location.name,
        isActive: location.status === 'active',
      }));
    },
  });
}
