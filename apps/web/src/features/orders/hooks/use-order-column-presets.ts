/**
 * Order Column Preset Hooks (#3530, D32)
 *
 * Shared by the export dialog (`OrderExportDialog`) and, in a later pass,
 * the orders list's own column picker — one preset shape backs both
 * surfaces (`OrderColumnPreset.columns`, the #3530 docblock's own words).
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderColumnPreset } from '../api/orders.types';

export function useOrderColumnPresetsQuery(): UseQueryResult<OrderColumnPreset[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ordersQueryKeys.columnPresets(),
    queryFn: () => apiClient.orders.listColumnPresets(),
  });
}

export function useWorkspaceDefaultColumnPresetQuery(): UseQueryResult<OrderColumnPreset | null> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ordersQueryKeys.workspaceDefaultColumnPreset(),
    queryFn: () => apiClient.orders.getWorkspaceDefaultColumnPreset(),
  });
}

export function useCreateColumnPresetMutation(): UseMutationResult<
  OrderColumnPreset,
  Error,
  { name: string; columns: string[] }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, columns }) => apiClient.orders.createColumnPreset(name, columns),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.columnPresets() });
    },
  });
}

export function useDeleteColumnPresetMutation(): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => apiClient.orders.deleteColumnPreset(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.columnPresets() });
    },
  });
}

/** Admin only (enforced server-side). */
export function useSetWorkspaceDefaultColumnPresetMutation(): UseMutationResult<
  OrderColumnPreset,
  Error,
  string[]
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (columns) => apiClient.orders.setWorkspaceDefaultColumnPreset(columns),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.workspaceDefaultColumnPreset() });
    },
  });
}
