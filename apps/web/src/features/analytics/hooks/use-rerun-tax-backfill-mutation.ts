/**
 * Rerun Tax Backfill Mutation Hook
 *
 * Wraps `POST /analytics/coverage/tax/rerun-backfill` (#2469) — the Data
 * Coverage panel's category-C ("rate not yet resolved") action. Invalidates
 * the coverage aggregate, the tax-orders drill-down, and the sales query on
 * success, since a resolved rate changes the category-C count, the
 * `detail-postrollout` list, and Net Sales downstream of it.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsCoverageQueryKeys } from '../api/analytics-coverage.query-keys';
import { analyticsTaxCoverageQueryKeys } from '../api/analytics-tax-coverage.query-keys';
import { salesAnalyticsQueryKeys } from '../api/sales-analytics.query-keys';
import type { RerunTaxBackfillInput, RerunTaxBackfillResult } from '../api/analytics-tax-coverage.types';

export function useRerunTaxBackfillMutation(): UseMutationResult<
  RerunTaxBackfillResult,
  Error,
  RerunTaxBackfillInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.analytics.rerunTaxBackfill(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: analyticsCoverageQueryKeys.all });
      await queryClient.invalidateQueries({ queryKey: analyticsTaxCoverageQueryKeys.all });
      await queryClient.invalidateQueries({ queryKey: salesAnalyticsQueryKeys.all });
    },
  });
}
