/**
 * Single sourcing-rule query (#3056)
 *
 * A sibling of `use-sourcing-rules-query.ts`, not a replacement: the table
 * renders from the list, and this is the by-id read for a surface that has only
 * an id (a deep link, a refetch after a conflict).
 *
 * Keyed under `byConnection`, like the list, so one write refreshes both.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { sourcingRulesQueryKeys } from '../api/sourcing-rules.query-keys';
import type { SourcingRule } from '../api/sourcing-rules.types';

export function useSourcingRuleQuery(
  connectionId: string | undefined,
  ruleId: string | undefined
): UseQueryResult<SourcingRule> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: sourcingRulesQueryKeys.detail(connectionId ?? '', ruleId ?? ''),
    queryFn: () => apiClient.sourcingRules.get(connectionId as string, ruleId as string),
    enabled:
      connectionId !== undefined &&
      connectionId.length > 0 &&
      ruleId !== undefined &&
      ruleId.length > 0,
  });
}
