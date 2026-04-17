import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { InventoryItem } from '../api/inventory.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useInventoryItemQuery(id: string): UseQueryResult<InventoryItem> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.detail(id),
    queryFn: () => apiClient.inventory.getById(id),
    enabled: Boolean(id),
  });
}
