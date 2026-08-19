/**
 * useSalesDocumentCountriesQuery (#2187)
 *
 * Mirrors `use-sales-document-rules-query.ts`'s shape exactly — a thin
 * `useQuery` wrapper over `apiClient.salesDocumentRules.listConfiguredCountries`,
 * backing the `SalesDocumentCountryIndex` table.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { SalesDocumentCountrySummary } from '../api/sales-document-rules.types';

export function useSalesDocumentCountriesQuery(): UseQueryResult<SalesDocumentCountrySummary[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentRulesQueryKeys.countries(),
    queryFn: () => apiClient.salesDocumentRules.listConfiguredCountries(),
  });
}
