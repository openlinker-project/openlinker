/**
 * Order Export Hooks (#3534/#3535, D35, mockup M5)
 *
 * `useOrderExportRunQuery` polls while `pending` (mockup states `preparing`
 * / `background`) and stops once the run reaches a terminal status —
 * `refetchInterval` returning `false` on a terminal read, the standard
 * TanStack Query "poll until done" shape.
 *
 * `useOrderExportBackgroundToast` (mockup M5 `background`) lives at PAGE level
 * on purpose: the dialog unmounts its polling the moment it closes, so a run
 * left preparing would otherwise finish unseen. The page hands it the run id
 * and it keeps polling the same query key, announcing the result once.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type UseMutationResult, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useToast } from '../../../shared/ui/toast-provider';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { CreateOrderExportRequest, OrderExportRun } from '../api/orders.types';
import { triggerBlobDownload } from '../../shipments';
import { formatExportCount, orderExportFileName } from '../lib/order-export-columns';
import { ORDER_EXPORT_COPY } from '../lib/order-export.copy';

const POLL_INTERVAL_MS = 2000;

/** Jobs & Logs pre-filtered to export runs (G03-12). */
export const ORDER_EXPORT_JOBS_PATH = '/jobs-logs?jobType=orders.export';

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
  { run: Pick<OrderExportRun, 'id' | 'format' | 'createdAt'> }
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ run }) => {
      const blob = await apiClient.orders.downloadExport(run.id);
      triggerBlobDownload(blob, orderExportFileName(run, run.format));
    },
    onSettled: async (_data, _error, variables) => {
      await queryClient.invalidateQueries({ queryKey: ordersQueryKeys.exportRun(variables.run.id) });
    },
  });
}

export interface OrderExportBackgroundToast {
  /** Keep watching a run the operator closed the dialog on, and toast its outcome. */
  track: (runId: string) => void;
}

export function useOrderExportBackgroundToast(): OrderExportBackgroundToast {
  const [runId, setRunId] = useState<string | null>(null);
  const runQuery = useOrderExportRunQuery(runId);
  const download = useDownloadExportMutation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  // The effect re-runs on every poll; this pins "announce a run once" to the
  // run id rather than to which dependency happened to change identity.
  const announced = useRef<string | null>(null);
  const startDownload = download.mutate;

  const run = runQuery.data;
  useEffect(() => {
    if (!run || run.id !== runId || announced.current === run.id) return;
    if (run.status === 'ready') {
      announced.current = run.id;
      showToast({
        tone: 'success',
        title: ORDER_EXPORT_COPY.toastReadyTitle,
        description: ORDER_EXPORT_COPY.toastReadyBody(
          formatExportCount(run.rowCount ?? 0),
          orderExportFileName(run, run.format),
        ),
        durationMs: 15000,
        action: {
          label: ORDER_EXPORT_COPY.toastDownload,
          onClick: () => { startDownload({ run }); },
        },
      });
      setRunId(null);
    } else if (run.status === 'failed') {
      announced.current = run.id;
      showToast({
        tone: 'error',
        title: ORDER_EXPORT_COPY.toastFailedTitle,
        description: run.errorMessage ?? ORDER_EXPORT_COPY.toastFailedBody,
        durationMs: 15000,
        action: {
          label: ORDER_EXPORT_COPY.toastViewJob,
          onClick: () => { void navigate(ORDER_EXPORT_JOBS_PATH); },
        },
      });
      setRunId(null);
    }
  }, [run, runId, showToast, navigate, startDownload]);

  const track = useCallback((id: string) => {
    announced.current = null;
    setRunId(id);
  }, []);

  return { track };
}
