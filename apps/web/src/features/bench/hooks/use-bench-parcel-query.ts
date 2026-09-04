/**
 * Bench parcel query (#2418, `W3b-5`, stories D1/D4)
 *
 * The open box, re-read while it is open.
 *
 * ## It polls because D4 requires it to
 *
 * *"I am told when the work changes underneath me"* — a box put on hold or
 * cancelled while a packer is scanning into it. Nothing pushes that to a bench,
 * so the only way the surface can interrupt rather than let the next scan fail
 * with a 409 the packer cannot interpret is to keep asking. Ten seconds, not the
 * list's thirty: the list is a queue someone glances at, and this is a box
 * someone has their hands in.
 *
 * ## It stops while the bench is locked, and while no box is open
 *
 * `enabled` follows the session for the list's own reason — the idle lock clears
 * it, and polling an anonymous bench fires unauthenticated reads at a terminal
 * nobody is standing at. It also stops when `workId` is `null`, so a bench
 * showing the list makes no parcel request at all.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchParcel } from '../api/bench-parcel.types';

/** How often an OPEN box is re-read. See the module docblock. */
export const BENCH_PARCEL_REFETCH_INTERVAL_MS = 10_000;

export function useBenchParcelQuery(workId: string | null): UseQueryResult<BenchParcel> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const signedIn = session.user !== null && session.user !== undefined;
  const enabled = signedIn && workId !== null;

  return useQuery({
    queryKey: benchQueryKeys.parcel(workId ?? ''),
    queryFn: () => apiClient.bench.getParcel(workId ?? ''),
    enabled,
    refetchInterval: enabled ? BENCH_PARCEL_REFETCH_INTERVAL_MS : false,
    refetchOnWindowFocus: true,
  });
}
