/**
 * useDeleteSalesDocumentRuleMutation (#2170)
 *
 * Invalidates every rules query rather than one country's, since the caller
 * (a rules-list row) knows the rule's id but the hook has no cheap way to
 * know which country it belonged to without a second read — invalidating
 * the whole `sales-document-rules` domain is the same trade-off
 * `useCreateConnectionMutation` makes with its `all` key.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';

export function useDeleteSalesDocumentRuleMutation(): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => apiClient.salesDocumentRules.deleteRule(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
    },
  });
}
