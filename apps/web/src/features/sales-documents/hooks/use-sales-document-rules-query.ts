/**
 * useSalesDocumentRulesQuery (#2170)
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { SalesDocumentRule } from '../api/sales-document-rules.types';

export function useSalesDocumentRulesQuery(country: string): UseQueryResult<SalesDocumentRule[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentRulesQueryKeys.rules(country),
    queryFn: () => apiClient.salesDocumentRules.listRules(country),
  });
}
