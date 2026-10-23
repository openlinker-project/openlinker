/**
 * Sourcing-rules list query (#3056)
 *
 * The ordered ruleset behind the #3057 table. The API returns rows already
 * sorted by `position` then `id` — the same tie-break the router applies — so
 * the listed order IS the evaluation order and nothing here re-sorts it. A
 * client-side sort would be a second opinion about the one thing this screen
 * exists to state.
 *
 * ## `enabled` on a missing connection id
 *
 * The page reads `connectionId` from a route param, so it can legitimately be
 * absent for a render or two. Firing anyway would request
 * `/connections//sourcing-rules` and surface a 404 as if the ruleset were
 * missing.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { sourcingRulesQueryKeys } from '../api/sourcing-rules.query-keys';
import type { SourcingRule, SourcingRuleFilters } from '../api/sourcing-rules.types';

export function useSourcingRulesQuery(
  connectionId: string | undefined,
  filters: SourcingRuleFilters = {}
): UseQueryResult<SourcingRule[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: sourcingRulesQueryKeys.list(connectionId ?? '', filters),
    queryFn: () => apiClient.sourcingRules.list(connectionId as string, filters),
    enabled: connectionId !== undefined && connectionId.length > 0,
  });
}
