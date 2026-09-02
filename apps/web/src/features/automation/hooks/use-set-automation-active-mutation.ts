/**
 * Arm / disarm one rule (#2364)
 *
 * ## Why this sends the whole definition
 *
 * The backend route is `PUT`, not `PATCH`, and that is deliberate on its side:
 * `updateRule` takes a COMPLETE input and re-validates and re-hashes all of it.
 * A body carrying `{isActive}` alone would null `conditions` and `actions`
 * through the narrowers — the rule would survive as a row and stop doing
 * anything, which is the worst possible outcome for a control labelled
 * "Turn off". So the mutation rebuilds the full definition from the rule it was
 * handed and changes exactly one field.
 *
 * ## Why it invalidates two keys
 *
 * The index's per-trigger count is derived from the same rows this write
 * touches. Invalidating only the list leaves a stale count one route up, where
 * the operator goes next.
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { automationQueryKeys } from '../api/automation.query-keys';
import type { AutomationRule } from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export interface SetAutomationActiveInput {
  rule: AutomationRule;
  isActive: boolean;
  /**
   * The §5.7 acknowledgement, required when ARMING a rule that carries an
   * irreversible step. Omitted when disarming: a rule being turned off spends
   * nothing, and the backend ignores an acknowledgement for a decision nobody
   * made rather than stamping it.
   */
  moneyAcknowledged?: boolean;
}

export function useSetAutomationActiveMutation(): UseMutationResult<
  AutomationRule,
  Error,
  SetAutomationActiveInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ rule, isActive, moneyAcknowledged }: SetAutomationActiveInput) =>
      apiClient.automations.replace(rule.id, {
        name: rule.name,
        trigger: rule.trigger,
        triggerConfig: rule.triggerConfig,
        conditions: rule.conditions,
        actions: rule.actions,
        isActive,
        effectiveFrom: rule.effectiveFrom,
        effectiveTo: rule.effectiveTo,
        ...(moneyAcknowledged === true ? { moneyAcknowledged: true } : {}),
      }),
    onSuccess: (_result, { rule }) => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.list(rule.trigger) });
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.summary() });
    },
  });
}
