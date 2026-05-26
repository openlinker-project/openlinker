import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from '../api/shipments.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useShipmentsQuery(
  filters?: ShipmentFilters,
  pagination?: ShipmentPagination,
): UseQueryResult<PaginatedShipments> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: shipmentsQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.shipments.list(filters, pagination),
  });
}
