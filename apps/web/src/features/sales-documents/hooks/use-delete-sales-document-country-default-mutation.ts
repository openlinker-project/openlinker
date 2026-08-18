/**
 * useDeleteSalesDocumentCountryDefaultMutation (#2170)
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';

export function useDeleteSalesDocumentCountryDefaultMutation(): UseMutationResult<
  void,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => apiClient.salesDocumentRules.deleteCountryDefault(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
    },
  });
}
