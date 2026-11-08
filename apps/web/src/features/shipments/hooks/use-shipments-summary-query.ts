/**
 * useShipmentsSummaryQuery (#4044)
 *
 * The shipments list's counts (#4043) for the same filters the list reads:
 * status tabs, filter options and "Needs a look". Kept apart from the list
 * query so a slow count never holds the rows back.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { ShipmentFilters, ShipmentSummary } from '../api/shipments.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useShipmentsSummaryQuery(filters?: ShipmentFilters): UseQueryResult<ShipmentSummary> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: shipmentsQueryKeys.summary(filters),
    queryFn: () => apiClient.shipments.summary(filters),
    placeholderData: keepPreviousData,
  });
}
