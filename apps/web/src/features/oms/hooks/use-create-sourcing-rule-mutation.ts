/**
 * Create-sourcing-rule mutation (#3056)
 *
 * ## Invalidate the whole CONNECTION, not the list key the caller is rendering
 *
 * A create inserts at a `position`, which moves every rule at or below it — so
 * refreshing only the query that issued the mutation would leave a sibling
 * query (the other `includeSuperseded` value, a detail read) rendering
 * positions that are no longer the router's. `byConnection` is a prefix of
 * every key for this connection and never touches another one's.
 *
 * ## Invalidate; never write the response into the cache
 *
 * The created rule comes back in full, so patching the list would be tempting
 * and wrong: the server renumbered its neighbours in the same write and the
 * response says nothing about them.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { sourcingRulesQueryKeys } from '../api/sourcing-rules.query-keys';
import type { CreateSourcingRuleRequest, SourcingRule } from '../api/sourcing-rules.types';

export interface CreateSourcingRuleInput extends CreateSourcingRuleRequest {
  connectionId: string;
}

export function useCreateSourcingRuleMutation(): UseMutationResult<
  SourcingRule,
  Error,
  CreateSourcingRuleInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, ...body }) => apiClient.sourcingRules.create(connectionId, body),
    onSuccess: async (_rule, { connectionId }) => {
      await queryClient.invalidateQueries({
        queryKey: sourcingRulesQueryKeys.byConnection(connectionId),
      });
    },
  });
}
