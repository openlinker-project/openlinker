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
 * ## The POLL is a cache writer too, and is guarded by the same rule (#2905)
 *
 * `useBenchVerifyMutation` guards its own `setQueryData` on `version`, but the
 * refetch below writes the cache on its own authority — so a read already in
 * flight when a verification resolves lands AFTER it and overwrites the answer
 * with the older parcel. That is precisely the "lower count than the server
 * holds" the mutation's guard exists to prevent, arriving through the other
 * channel, and under D18's auto-close it is invisible.
 *
 * `structuralSharing` is where a query decides what to keep, so both writers
 * now sit behind ONE rule — `isNewerParcelRead`. Two guards that agree today is
 * what the single-rule discipline elsewhere in this feature refuses.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { benchQueryKeys } from '../api/bench-work.query-keys';
import type { BenchParcel } from '../api/bench-parcel.types';
import { isNewerParcelRead } from '../lib/bench-parcel-presentation';

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
    // See the module docblock. Returning the CACHED read discards this one,
    // which is the intent: a stale poll must not undo a newer verification's
    // answer. Written as an early return rather than a ternary so the `previous`
    // branch never has to be cast — `isNewerParcelRead` answers `true` for an
    // absent cache, so reaching the second return proves one exists, and a cast
    // asserting that would make the reader re-derive it.
    structuralSharing: (previous, incoming) => {
      const cached = previous as BenchParcel | undefined;
      if (isNewerParcelRead(incoming as BenchParcel, cached)) return incoming;
      return cached;
    },
  });
}
