/**
 * useFiscalRegistrationQuery (#3307)
 *
 * Fetches one fiscal registration record by id — `GET /fiscal-registrations/:id`
 * (#3306). Backs the fiscal-receipt half of the merged /sales-documents
 * detail route, mirroring `use-invoice-query.ts` on the invoicing side.
 *
 * @module apps/web/src/features/fiscalization/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { fiscalizationQueryKeys } from '../api/fiscalization.query-keys';
import type { FiscalRegistrationRecord } from '../api/fiscalization.types';

export function useFiscalRegistrationQuery(id: string): UseQueryResult<FiscalRegistrationRecord> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: fiscalizationQueryKeys.detail(id),
    queryFn: () => apiClient.fiscalization.getById(id),
    enabled: id.length > 0,
  });
}
