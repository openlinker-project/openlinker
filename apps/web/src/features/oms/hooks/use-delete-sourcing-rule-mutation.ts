/**
 * Delete-sourcing-rule mutation (#3056)
 *
 * A HARD delete, including the rule's history. The non-destructive alternative
 * is `useUpdateSourcingRuleMutation` with `effectiveTo` in the past, which is
 * what the partial duplicate-detection index exists to allow: a retired rule
 * coexists with its replacement.
 *
 * Deleting leaves a GAP in the position sequence — the API does not renumber.
 * That is correct (a renumber would move rules the operator did not touch), and
 * it is why `byConnection` is still the invalidation key: the remaining rows
 * are unchanged but the list that describes them is not.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { sourcingRulesQueryKeys } from '../api/sourcing-rules.query-keys';

export interface DeleteSourcingRuleInput {
  connectionId: string;
  ruleId: string;
}

export function useDeleteSourcingRuleMutation(): UseMutationResult<
  void,
  Error,
  DeleteSourcingRuleInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, ruleId }) => apiClient.sourcingRules.remove(connectionId, ruleId),
    onSuccess: async (_void, { connectionId }) => {
      await queryClient.invalidateQueries({
        queryKey: sourcingRulesQueryKeys.byConnection(connectionId),
      });
    },
  });
}
