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
    onSuccess: async (_rule, input) => {
      await queryClient.invalidateQueries({
        queryKey: salesDocumentRulesQueryKeys.rules(input.country),
      });
    },
  });
}
