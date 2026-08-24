/**
 * useAdoptSalesDocumentTemplateMutation (#2170)
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { AdoptSalesDocumentTemplateInput, SalesDocumentRule } from '../api/sales-document-rules.types';

export interface AdoptSalesDocumentTemplateVariables {
  country: string;
  input: AdoptSalesDocumentTemplateInput;
}

export function useAdoptSalesDocumentTemplateMutation(): UseMutationResult<
  SalesDocumentRule[],
  Error,
  AdoptSalesDocumentTemplateVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ country, input }) => apiClient.salesDocumentRules.adoptTemplate(country, input),
    onSuccess: async () => {
      // Invalidate the whole domain, not just this country's own rules —
      // matching every deletion/reset/acknowledge hook in this feature
      // (review finding 7). `countries()` (the index's Status column) also
      // needs to move after adopting; the narrower key left it stale for the
      // 30s default `staleTime`, reading as a failed save.
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
    },
  });
}
