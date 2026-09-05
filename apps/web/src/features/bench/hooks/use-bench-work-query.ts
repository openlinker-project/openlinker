/**
 * Bench work query (#2416, `W3b-3`)
 *
 * ## It polls, because the copy promises it does
 *
 * The surface says *"New work turns up here on its own — you do not need to
 * refresh"*. A query without an interval makes that a promise nothing keeps,
 * and a bench screen left open through a shift would show a frozen list beside
 * a sentence claiming otherwise. Thirty seconds: work arrives at the pace a
 * marketplace poll ingests it, and a packer glancing up mid-parcel should not
 * see the list move under them more often than that.
 *
 * ## It stops while the bench is locked
 *
 * `enabled` follows the session. The idle lock CLEARS the session (#2413), so
 * without this the poll would keep firing unauthenticated requests at a bench
 * nobody is standing at — and would repopulate a cache the lock deliberately
 * emptied.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchWorkList } from '../api/bench-work.types';

/** How often the bench re-reads its work. See the module docblock. */
export const BENCH_WORK_REFETCH_INTERVAL_MS = 30_000;

export function useBenchWorkQuery(): UseQueryResult<BenchWorkList> {
  const apiClient = useApiClient();
  const { session } = useSession();
  // The same predicate `useBenchIdentity` uses, and for the same reason: an
  // anonymous session is what the idle lock leaves behind, and polling through
  // it would fire unauthenticated reads at a bench nobody is standing at.
  const signedIn = session.user !== null && session.user !== undefined;

  return useQuery({
    queryKey: benchQueryKeys.work(),
    queryFn: () => apiClient.bench.listWork(),
    enabled: signedIn,
    refetchInterval: signedIn ? BENCH_WORK_REFETCH_INTERVAL_MS : false,
    // A packer returning to the terminal should see the truth immediately,
    // not up to half a minute of a stale queue.
    refetchOnWindowFocus: true,
  });
}
