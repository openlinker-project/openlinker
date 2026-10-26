/**
 * useCorrectStockMutation (#3567)
 *
 * Explicit invalidation on settle, no optimistic update: whether the master
 * applied the change is exactly what the operator is waiting to learn, so the
 * caches are refetched rather than guessed at. Settle (not success) because a
 * refused or in-doubt outcome still writes a ledger row.
 *
 * @module apps/web/src/features/inventory/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { productsQueryKeys } from '../../products/api/products.query-keys';
import { inventoryQueryKeys } from '../api/inventory.query-keys';
import type { CorrectStockInput, CorrectStockResult } from '../api/inventory-correction.types';

export interface CorrectStockVariables {
  productVariantId: string;
  input: CorrectStockInput;
}

export function useCorrectStockMutation(): UseMutationResult<
  CorrectStockResult,
  Error,
  CorrectStockVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ productVariantId, input }) => apiClient.inventory.correctStock(productVariantId, input),
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.stockViewAll() }),
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.listAll() }),
        queryClient.invalidateQueries({ queryKey: inventoryQueryKeys.movementsAll() }),
        // The products list, its KPIs and the product detail show stock too.
        queryClient.invalidateQueries({ queryKey: productsQueryKeys.all }),
      ]);
    },
  });
}
