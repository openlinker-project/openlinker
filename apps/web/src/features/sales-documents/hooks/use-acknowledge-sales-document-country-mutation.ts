/**
 * useAcknowledgeSalesDocumentCountryMutation (#2189)
 *
 * Backs the routing dialog's "Mark as no sales document" banner action
 * (`PUT /sales-documents/countries/:country/acknowledgment`, #2186). Invalidates
 * the whole `sales-document-rules` domain rather than a narrower key — the
 * `countries()` list (driving both the index's Status column and this
 * dialog's own banner) is the query that actually needs to move, and there is
 * no cheaper key that covers it alone.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { SalesDocumentCountryAcknowledgment } from '../api/sales-document-rules.types';

export function useAcknowledgeSalesDocumentCountryMutation(): UseMutationResult<
  SalesDocumentCountryAcknowledgment,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (country) => apiClient.salesDocumentRules.acknowledgeNoDocument(country),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: salesDocumentRulesQueryKeys.all });
    },
  });
}
