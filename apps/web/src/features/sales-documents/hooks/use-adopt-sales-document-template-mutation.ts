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
    onSuccess: async (_rules, { country }) => {
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.rules(country) });
    },
  });
}
