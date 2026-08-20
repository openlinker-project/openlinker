/**
 * useUpsertSalesDocumentCountryDefaultMutation (#2170)
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type {
  SalesDocumentCountryDefault,
  UpsertSalesDocumentCountryDefaultInput,
} from '../api/sales-document-rules.types';

export function useUpsertSalesDocumentCountryDefaultMutation(): UseMutationResult<
  SalesDocumentCountryDefault,
  Error,
  UpsertSalesDocumentCountryDefaultInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.salesDocumentRules.upsertCountryDefault(input),
    onSuccess: async () => {
      // Invalidate the whole domain, not just this country's own defaults —
      // matching every deletion/reset/acknowledge hook in this feature
      // (review finding 7). `countries()` (the index's Status column) also
      // needs to move after a save; the narrower key left it stale for the
      // 30s default `staleTime`, reading as a failed save.
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
    },
  });
}
