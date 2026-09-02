/**
 * useSalesDocumentMarketsQuery (#2540)
 *
 * Thin `useQuery` wrapper over `apiClient.salesDocumentRules.listMarkets` —
 * the single merged read backing the settings page's market list, summary,
 * detected-market rows and their loading states. One query, four consumers,
 * so none of them can read a different snapshot than the others.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentRulesQueryKeys } from '../api/sales-document-rules.query-keys';
import type { SalesDocumentMarketsResponse } from '../api/sales-document-markets.types';

export function useSalesDocumentMarketsQuery(): UseQueryResult<SalesDocumentMarketsResponse> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentRulesQueryKeys.markets(),
    queryFn: () => apiClient.salesDocumentRules.listMarkets(),
  });
}
