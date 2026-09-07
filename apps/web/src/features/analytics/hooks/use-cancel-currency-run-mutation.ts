/**
 * Cancel Currency Run Mutation Hook
 *
 * Wraps `POST /analytics/coverage/currency/cancel` (#2816) - the recovery
 * path for a currency-remediation run stranded at `in-progress` because its
 * driver job died before it could terminalise itself (a malformed payload, an
 * exhausted retry ladder, a saturated `bulk` lane). Without it, the panel's
 * "Recalculate now" surfaced that state only as a 409 the operator could not
 * act on, forever.
 *
 * Invalidates the coverage read on success, mirroring
 * `useRecalculateCurrencyMutation`: the cancelled run is now terminal
 * (`failed`), and the coverage aggregate's `activeRunId` for the category
 * must clear so the panel does not keep polling a run that no longer exists.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsCoverageQueryKeys } from '../api/analytics-coverage.query-keys';
import type { AnalyticsRemediationRun } from '../api/analytics-remediation.types';

export function useCancelCurrencyRunMutation(): UseMutationResult<AnalyticsRemediationRun, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.analytics.cancelStuckCurrencyRun(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: analyticsCoverageQueryKeys.all });
    },
  });
}
