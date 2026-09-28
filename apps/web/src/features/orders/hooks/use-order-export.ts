/**
 * Order Export Hooks (#3534/#3535, D35, mockup M5)
 *
 * `useOrderExportRunQuery` polls while `pending` (mockup states `preparing`
 * / `background`) and stops once the run reaches a terminal status —
 * `refetchInterval` returning `false` on a terminal read, the standard
 * TanStack Query "poll until done" shape.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { CreateOrderExportRequest, OrderExportRun } from '../api/orders.types';
import { triggerBlobDownload } from '../../shipments';

const POLL_INTERVAL_MS = 2000;

export function useRequestExportMutation(): UseMutationResult<
  OrderExportRun,
  Error,
  CreateOrderExportRequest
> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (body) => apiClient.orders.requestExport(body),
  });
}

export function useOrderExportRunQuery(
  runId: string | null,
): UseQueryResult<OrderExportRun> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: ordersQueryKeys.exportRun(runId ?? ''),
    queryFn: () => apiClient.orders.getExportRun(runId as string),
    enabled: runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'ready' || status === 'failed' ? false : POLL_INTERVAL_MS;
    },
  });
}

export function useDownloadExportMutation(): UseMutationResult<
  void,
  Error,
  { runId: string; format: 'csv' | 'xlsx' }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runId, format }) => {
      const blob = await apiClient.orders.downloadExport(runId);
      const date = new Date().toISOString().slice(0, 10);
      triggerBlobDownload(blob, `orders-export-${date}.${format}`);
    },
    onSettled: async (_data, _error, variables) => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.exportRun(variables.runId) });
    },
  });
}
