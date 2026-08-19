/**
 * useClearSalesDocumentCountryAcknowledgmentMutation (#2189)
 *
 * Backs both the routing dialog's acknowledged-banner "Undo" action and its
 * "Reset country" composed flow (`DELETE
 * /sales-documents/countries/:country/acknowledgment`, #2186).
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';

export function useClearSalesDocumentCountryAcknowledgmentMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (country) => apiClient.salesDocumentRules.clearAcknowledgment(country),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
    },
  });
}
