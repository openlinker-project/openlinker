/**
 * useSalesDocumentCountryDefaultsQuery (#2170)
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { SalesDocumentCountryDefault } from '../api/sales-document-rules.types';

export function useSalesDocumentCountryDefaultsQuery(
  country: string,
): UseQueryResult<SalesDocumentCountryDefault[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentRulesQueryKeys.countryDefaults(country),
    queryFn: () => apiClient.salesDocumentRules.listCountryDefaults(country),
  });
}
