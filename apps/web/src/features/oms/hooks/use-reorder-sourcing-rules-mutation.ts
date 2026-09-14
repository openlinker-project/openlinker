/**
 * Reorder-sourcing-rules mutation (#3056)
 *
 * Renumbers every non-retired rule to a dense `1..N`.
 *
 * ## The id list is EXHAUSTIVE, and the caller owns it
 *
 * The API refuses a body naming a subset (409, with `missingRuleIds` and
 * `unknownRuleIds`) and writes nothing — a partial reorder would leave the
 * un-named rules at stale positions while looking like it worked. So this hook
 * sends the caller's list verbatim and never derives it from the cache: a list
 * assembled here from a possibly-stale query would be the client manufacturing
 * exactly the mismatch the server exists to refuse, and the operator would see
 * a conflict about rules they never touched.
 *
 * ## Invalidate on failure too — but only on the conflict
 *
 * A reorder mismatch means the server's live set is not the one this surface
 * rendered, so the surface refreshes ITSELF rather than asking the operator to
 * reload. Any other failure says nothing about staleness and leaves the cache
 * alone (the `useFulfillmentTaskActionMutation` precedent).
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { sourcingRulesQueryKeys } from '../api/sourcing-rules.query-keys';
import type { SourcingRule } from '../api/sourcing-rules.types';
import { readSourcingRuleConflict } from '../lib/sourcing-rule-conflict';

export interface ReorderSourcingRulesInput {
  connectionId: string;
  /** Every non-retired rule id, exactly once, in the order they should run. */
  ruleIds: string[];
}

export function useReorderSourcingRulesMutation(): UseMutationResult<
  SourcingRule[],
  Error,
  ReorderSourcingRulesInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, ruleIds }) =>
      apiClient.sourcingRules.reorder(connectionId, { ruleIds }),
    onSuccess: async (_rules, { connectionId }) => {
      await queryClient.invalidateQueries({
        queryKey: sourcingRulesQueryKeys.byConnection(connectionId),
      });
    },
    onError: async (error: Error, { connectionId }) => {
      if (readSourcingRuleConflict(error)) {
        await queryClient.invalidateQueries({
          queryKey: sourcingRulesQueryKeys.byConnection(connectionId),
        });
      }
    },
  });
}
