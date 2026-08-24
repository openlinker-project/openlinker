/**
 * useCreateSalesDocumentRuleMutation (#2170)
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { CreateSalesDocumentRuleInput, SalesDocumentRule } from '../api/sales-document-rules.types';

export function useCreateSalesDocumentRuleMutation(): UseMutationResult<
  SalesDocumentRule,
  Error,
  CreateSalesDocumentRuleInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.salesDocumentRules.createRule(input),
    onSuccess: async () => {
      // Invalidate the whole domain, not just this country's own rules —
      // matching every deletion/reset/acknowledge hook in this feature
      // (review finding 7). `countries()` (the index's Status column) also
      // needs to move after a save; the narrower key left it stale for the
      // 30s default `staleTime`, reading as a failed save.
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
    },
  });
}
