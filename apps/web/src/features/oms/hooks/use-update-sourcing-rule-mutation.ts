/**
 * Update-sourcing-rule mutation (#3056)
 *
 * Patches one rule. `kind` is absent from the body type — it is half the rule's
 * identity and the API does not accept it; changing it is delete-and-recreate.
 *
 * Retiring a rule is this mutation with `effectiveTo` set to a past instant —
 * the non-destructive alternative to DELETE, which #3059 surfaces. There is no
 * separate "retire" client method, because a second method for one field value
 * is how the two would come to send different bodies.
 *
 * Invalidates `byConnection` for the same reason the create does: `position` is
 * patchable, so one edit can move rows this response does not describe.
 *
 * @module apps/web/src/features/oms/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { sourcingRulesQueryKeys } from '../api/sourcing-rules.query-keys';
import type { SourcingRule, UpdateSourcingRuleRequest } from '../api/sourcing-rules.types';

export interface UpdateSourcingRuleInput extends UpdateSourcingRuleRequest {
  connectionId: string;
  ruleId: string;
}

export function useUpdateSourcingRuleMutation(): UseMutationResult<
  SourcingRule,
  Error,
  UpdateSourcingRuleInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, ruleId, ...body }) =>
      apiClient.sourcingRules.update(connectionId, ruleId, body),
    onSuccess: async (_rule, { connectionId }) => {
      await queryClient.invalidateQueries({
        queryKey: sourcingRulesQueryKeys.byConnection(connectionId),
      });
    },
  });
}
