/**
 * Recalculate Currency Mutation Hook
 *
 * Wraps `POST /analytics/coverage/currency/recalculate` (#2468). Invalidates
 * both the coverage read and the sales query on success, since a queued
 * recalculation eventually changes both the pending count and the figures
 * downstream of it.
 *
 * @module apps/web/src/features/analytics/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { AnalyticsRemediationRun, RecalculateCurrencyInput } from '../api/analytics-remediation.types';

export function useRecalculateCurrencyMutation(): UseMutationResult<
  AnalyticsRemediationRun,
  Error,
  RecalculateCurrencyInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.analytics.recalculateCurrency(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['analytics', 'coverage'] });
      await queryClient.invalidateQueries({ queryKey: ['analytics', 'sales'] });
    },
  });
}
