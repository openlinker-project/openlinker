/**
 * Who else has this box open (#3406, mockup-parity epic #3401)
 *
 * The ping and the read are ONE call: announcing yourself is what refreshes
 * your own claim, and the answer is the roster of everyone else's. So this is
 * a `useQuery` over a POST rather than a mutation — the surface polls it, and
 * every poll both says "still here" and asks "who else".
 *
 * ## The interval is the contract's other half
 *
 * The server's presence TTL is 30 s, three times this interval, so a packer
 * survives two dropped pings — warehouse Wi-Fi, a tab the browser throttled —
 * before they stop being advertised. Slowing this poll down without moving
 * that TTL makes the banner flicker between two packers who are both still
 * standing there, and a banner that flickers is one they learn to ignore.
 *
 * ## It stops when the bench is not in use
 *
 * `enabled` is false while the box is closed, refused, or while the idle lock
 * covers the bench (A3). A locked terminal that kept pinging would advertise
 * a packer who walked away, to a colleague who would then not open the box.
 *
 * ## A failed read says NOTHING, in either direction
 *
 * The caller reads `others` off `data`, which is `undefined` until the first
 * answer and after a failure. That renders no banner — and no reassurance
 * either, which is the point: "nobody else is in this box" is a claim a read
 * that did not happen has no standing to make.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import type { BenchPresence } from '../api/bench-parcel.types';
import { benchQueryKeys } from '../api/bench-work.query-keys';

/** Matches the parcel surface's own refetch cadence; see the docblock. */
export const BENCH_PRESENCE_PING_INTERVAL_MS = 10_000;

export function useBenchPresenceQuery(
  workId: string | null,
  options: { readonly enabled?: boolean } = {}
): UseQueryResult<BenchPresence> {
  const apiClient = useApiClient();
  const { session } = useSession();
  const signedIn = session.user !== null && session.user !== undefined;
  const enabled = signedIn && workId !== null && (options.enabled ?? true);

  return useQuery({
    queryKey: benchQueryKeys.presence(workId ?? ''),
    queryFn: () => apiClient.bench.pingPresence(workId ?? ''),
    enabled,
    refetchInterval: enabled ? BENCH_PRESENCE_PING_INTERVAL_MS : false,
    // Keeps pinging while the packer is looking at the box on another tab's
    // monitor — a bench terminal is rarely the focused window.
    refetchIntervalInBackground: true,
    // A missed ping is not worth a retry storm: the next interval is 10 s away
    // and carries the same question.
    retry: false,
  });
}
