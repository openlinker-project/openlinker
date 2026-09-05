/**
 * Can this bench reach OpenLinker? (#2421, `W3b-8`, story H1)
 *
 * ## What H1 asks for, read precisely
 *
 * *"Scans already recorded are not lost, the surface says plainly that it is
 * offline, and does not accept work it cannot record while pretending
 * otherwise."*
 *
 * **"Already recorded" means already accepted by the server.** This is NOT an
 * offline queue and must not become one. A queue that replays later would have
 * to decide who a replayed gesture is attributed to on a shared roaming
 * terminal (ADR-071's whole subject), would collide with D21's
 * change-interruption — a scan replayed into a box that was cancelled while the
 * bench was dark — and would make the auto-close of D18 fire on a count
 * assembled minutes after the packer walked away. The spec does not ask for it.
 * The commitment here is the smaller, honest one: keep what is confirmed, say
 * plainly that the bench cannot reach OpenLinker, and refuse new work out loud
 * rather than swallowing it.
 *
 * ## The flag must not LATCH, and that is the whole difficulty
 *
 * The obvious design — set unreachable on a failed request, clear on the
 * `online` event — is unrecoverable in the commonest case. `navigator.onLine`
 * reports the machine's own link, so when the SERVER is unreachable over a
 * perfectly good LAN it never goes false and no `online` event is ever fired.
 * The bench would then refuse every scan for the rest of the shift on a network
 * that recovered thirty seconds later, and a bench that will not accept work is
 * worse than the failure it was guarding against.
 *
 * So clearing comes from a POSITIVE reachability signal that arrives without
 * the packer's cooperation: the parcel read polls on its own, and any answer
 * from the server — including a refusal, which is still an answer — proves the
 * bench is reachable. `navigator.onLine === false` stays a separate OR term
 * because it is reliable in the negative and clears itself.
 *
 * ## One failed request is enough to refuse
 *
 * Deliberately not a threshold. H1 puts refusing above accepting-and-hoping, and
 * the cost of being wrong is one scan the packer repeats; the cost the other way
 * is a unit the packer believes is in the box. The copy therefore never claims
 * the packer's network is down — it says the bench cannot reach OpenLinker,
 * which is the only thing either signal actually establishes.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '../../../shared/api/api-error';

export interface BenchReachability {
  /** True when the bench must refuse new work and say so. */
  readonly unreachable: boolean;
  /** Report that a request never reached the server. */
  readonly reportUnreachable: () => void;
  /** Report that the server answered — anything at all. */
  readonly reportReached: () => void;
}

/**
 * Did this failure mean the request never reached OpenLinker?
 *
 * `ApiError.status === 0` is minted by BOTH `fromNetworkFailure` and
 * `fromTimeout`, which is exactly the pair that means "no answer". Every HTTP
 * status — including a 500 — is an answer and leaves the bench reachable: a
 * server that is refusing loudly is not a server the packer cannot talk to, and
 * treating it as one would refuse work over a bug in one endpoint.
 */
export function isUnreachableFailure(error: unknown): boolean {
  return error instanceof ApiError && error.isNetworkError();
}

export function useBenchReachability(): BenchReachability {
  // Seeded from the browser's own answer so a bench opened with the cable out
  // says so before the first scan rather than after it.
  const [requestFailed, setRequestFailed] = useState(false);
  const [linkDown, setLinkDown] = useState(
    () => typeof navigator !== 'undefined' && navigator.onLine === false
  );

  useEffect(() => {
    const goOffline = (): void => {
      setLinkDown(true);
    };
    const goOnline = (): void => {
      setLinkDown(false);
      // The link returning is not proof the SERVER is back, so the
      // request-derived half is deliberately left standing — only an actual
      // answer clears that one.
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  const reportUnreachable = useCallback(() => {
    setRequestFailed(true);
  }, []);

  const reportReached = useCallback(() => {
    setRequestFailed(false);
  }, []);

  // Memoised so the object identity changes only when the answer does. The
  // consuming surface lists this in an effect's dependencies; a fresh literal
  // every render would re-run that effect every render — harmless today,
  // because it only calls stable setters and React bails out on an unchanged
  // value, and a loop the moment it does anything else.
  return useMemo(
    () => ({
      unreachable: requestFailed || linkDown,
      reportUnreachable,
      reportReached,
    }),
    [requestFailed, linkDown, reportUnreachable, reportReached]
  );
}
