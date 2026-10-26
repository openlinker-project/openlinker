/**
 * useStockViewQuery
 *
 * One product's stock view (#3569): available to promise with provenance, the
 * held split, positions, holds and per-channel figures, in a single read.
 * Disabled for an empty id.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { StockView } from '../api/inventory.types';

export function useStockViewQuery(productId: string): UseQueryResult<StockView> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: inventoryQueryKeys.stockView(productId),
    queryFn: () => apiClient.inventory.stockView(productId),
    enabled: Boolean(productId),
  });
}
