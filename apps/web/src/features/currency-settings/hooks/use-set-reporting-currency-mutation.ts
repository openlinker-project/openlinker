/**
 * Set Reporting Currency Mutation
 *
 * Persists an operator's reporting-currency choice. Invalidates the settings
 * query on success so the tile + dialog refetch the new state — in
 * particular the stamped-order counts, since a fresh save starts a new era.
 *
 * @module apps/web/src/features/currency-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { currencySettingsQueryKeys } from '../api/currency-settings.query-keys';
import type { SetReportingCurrencyInput } from '../api/currency-settings.types';

export function useSetReportingCurrencyMutation(): UseMutationResult<
  void,
  Error,
  SetReportingCurrencyInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.currencySettings.setReportingCurrency(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: currencySettingsQueryKeys.all });
    },
  });
}
