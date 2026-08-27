/**
 * The dry run (#2366, spec §5.6a)
 *
 * ## This mutation INVALIDATES NOTHING, deliberately
 *
 * `POST /automations/evaluate` commits nothing and dispatches nothing — it is a
 * mutation only in the HTTP-verb sense. Invalidating a query key would tell
 * TanStack the server state changed, which is precisely the claim this endpoint
 * exists NOT to make: a refetched rule list after a "test" would imply the test
 * touched something.
 *
 * The missing `onSuccess` is the point. Do not add one.
 *
 * @module apps/web/src/features/automation/hooks
 */
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type {
  AutomationDryRunResult,
  AutomationEvaluateInput,
} from '../api/automation.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useEvaluateAutomationMutation(): UseMutationResult<
  AutomationDryRunResult,
  Error,
  AutomationEvaluateInput
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (input: AutomationEvaluateInput) => apiClient.automations.evaluate(input),
  });
}
