/**
 * Recent activity, packed-today, and the metric row (#3411/#3413,
 * mockup-parity epic #3401)
 *
 * Three independent reads, following `use-bench-documents-query.ts`'s own
 * shape: signed-in-gated, each scoped exactly as its endpoint is scoped.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import type { BenchActivityEntry, BenchMetrics, BenchPackedTodayList } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';

export function useBenchActivityQuery(
  workId: string | null,
  options: { readonly enabled?: boolean } = {}
): UseQueryResult<readonly BenchActivityEntry[]> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const signedIn = session.user !== null && session.user !== undefined;
  const enabled = signedIn && workId !== null && (options.enabled ?? true);

  return useQuery({
    queryKey: benchQueryKeys.activity(workId ?? ''),
    queryFn: () => apiClient.bench.listActivity(workId ?? ''),
    enabled,
  });
}

export function useBenchPackedTodayQuery(
  options: { readonly enabled?: boolean } = {}
): UseQueryResult<BenchPackedTodayList> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const signedIn = session.user !== null && session.user !== undefined;
  const enabled = signedIn && (options.enabled ?? true);

  return useQuery({
    queryKey: benchQueryKeys.packedToday(),
    queryFn: () => apiClient.bench.listPackedToday(),
    enabled,
  });
}

export function useBenchMetricsQuery(
  options: { readonly enabled?: boolean } = {}
): UseQueryResult<BenchMetrics> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const signedIn = session.user !== null && session.user !== undefined;
  const enabled = signedIn && (options.enabled ?? true);

  return useQuery({
    queryKey: benchQueryKeys.metrics(),
    queryFn: () => apiClient.bench.getMetrics(),
    enabled,
    // The mockup's metric row is a background fact, not a live one a packer
    // stares at — refetch on an interval rather than on every render, so it
    // stays roughly current without adding a request to the hot scan path.
    refetchInterval: 60_000,
  });
}
