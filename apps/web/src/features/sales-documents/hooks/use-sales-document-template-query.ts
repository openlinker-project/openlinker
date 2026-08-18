/**
 * useSalesDocumentTemplateQuery (#2170)
 *
 * `null` data means "no curated template for this country" — not loading,
 * not an error. The Poland-only "Review & adopt" screen renders only when
 * data is non-null.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { SalesDocumentStarterTemplate } from '../api/sales-document-rules.types';

export function useSalesDocumentTemplateQuery(
  country: string,
): UseQueryResult<SalesDocumentStarterTemplate | null> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentRulesQueryKeys.template(country),
    queryFn: () => apiClient.salesDocumentRules.getTemplate(country),
  });
}
