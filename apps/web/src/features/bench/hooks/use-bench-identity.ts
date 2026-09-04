/**
 * Bench identity state (#2413, stories A2–A4, ADR-071)
 *
 * Owns the three designed states of the bench identity surface — `open`,
 * `locked`, `handover` — plus the idle clock and the two session transitions
 * that make them true rather than cosmetic.
 *
 * ## Locking CLEARS the session, and that is the point
 *
 * A DOM overlay over a still-authenticated browser is not a lock; it is a
 * curtain. Story A3 says *"no scan is attributed to me until someone signs
 * in"*, and the only way that holds against a shared terminal is if the
 * outgoing token is gone. So `lock()` clears the session AND the react-query
 * cache — the cache half matters because `clearSession` does not touch it, so
 * an incoming packer on a shared browser profile would otherwise read the
 * outgoing packer's cached responses.
 *
 * ## And progress survives anyway, because the LOCK IS AN OVERLAY
 *
 * *"Locking never discards progress."* That is not achieved by keeping the
 * session — it is achieved by never unmounting the bench body. The overlay is
 * rendered ABOVE the children, never as a route change and never in place of
 * them, so component state under it is untouched by a lock, a handover, or a
 * sign-in. `bench-surface.test.tsx` proves it with a stateful child
 * across lock, handover and a fresh sign-in.
 *
 * ## Handover is two steps on purpose
 *
 * `requestHandover()` shows what the outgoing packer already verified BEFORE
 * the switch, because whoever finishes the box is the one recorded as having
 * packed it (spec D13). Only `confirmHandover()` clears the session. A
 * one-tap switch would take the parcel off the outgoing packer without the
 * incoming one seeing what they were inheriting.
 *
 * @module apps/web/src/features/bench/hooks
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useSession } from '../../../shared/auth/use-session';
import { useIdleTimeout } from '../../../shared/hooks/use-idle-timeout';

export type BenchIdentityState = 'open' | 'locked' | 'handover';

/**
 * Five minutes (spec § 4 open question 1).
 *
 * Long enough to survive fetching a box from a rack or answering a colleague;
 * short enough that a terminal left for a break is not still signed in.
 * Terminals are shared and roaming (D15) but a person changes terminal only a
 * few times a shift (D16), so re-authenticating after a genuine absence is the
 * friction ADR-071 already accepted — this value should not be tuned to avoid
 * it.
 */
export const BENCH_IDLE_TIMEOUT_DEFAULT_MS = 5 * 60 * 1000;

/**
 * Build-time, not runtime (`docs/frontend-architecture.md § Runtime
 * Configuration`): `VITE_*` is baked into the bundle, so changing it means a
 * rebuild, not a redeploy of config. An unparseable or non-positive value falls
 * back to the default rather than disabling the lock — a bench that never locks
 * because of a typo is the failure this whole story exists to prevent.
 */
export function resolveBenchIdleTimeoutMs(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : BENCH_IDLE_TIMEOUT_DEFAULT_MS;
}

export interface UseBenchIdentityResult {
  readonly state: BenchIdentityState;
  readonly signedInName: string | null;
  /** Lock now, without waiting for the idle clock. */
  readonly lock: () => void;
  /** Step one of a handover: show the incoming packer what is already done. */
  readonly requestHandover: () => void;
  /** Step two: actually clear the outgoing session. */
  readonly confirmHandover: () => Promise<void>;
  /** Back out of a handover without switching. */
  readonly cancelHandover: () => void;
}

export interface UseBenchIdentityOptions {
  readonly idleTimeoutMs?: number;
}

export function useBenchIdentity(options: UseBenchIdentityOptions = {}): UseBenchIdentityResult {
  const { session, clearSession } = useSession();
  const queryClient = useQueryClient();
  const [state, setState] = useState<BenchIdentityState>('open');

  const idleTimeoutMs = options.idleTimeoutMs ?? BENCH_IDLE_TIMEOUT_DEFAULT_MS;
  const signedIn = session.user !== null && session.user !== undefined;

  /**
   * Clear the outgoing principal for real.
   *
   * `clearSession()` alone drops the in-memory access token and posts a logout;
   * it leaves react-query holding every response the outgoing packer fetched.
   * On a shared browser profile that is a live mis-attribution path — the
   * incoming packer reads somebody else's data and their first action lands
   * against it.
   */
  const clearPrincipal = useCallback(async (): Promise<void> => {
    // `finally`, not sequential: `clearSession()` posts a logout, and on a
    // warehouse network that request is exactly what fails. Dropping the local
    // cache only on the happy path would leave the *stronger* guarantee
    // conditional on the network being up — the lock must be at least as strong
    // offline as online.
    try {
      await clearSession();
    } finally {
      queryClient.clear();
    }
  }, [clearSession, queryClient]);

  const lock = useCallback((): void => {
    setState('locked');
    // The state flips FIRST and unconditionally: a lock that reported success
    // only when the logout POST returned would leave a failed request looking
    // like an unlocked bench. The catch is not optional — an unhandled
    // rejection here is a security-path promise nobody is watching.
    clearPrincipal().catch(() => {
      /* Reported by the adapter's own logging; the local session is cleared
         either way by the `finally` above. */
    });
  }, [clearPrincipal]);

  const { reset } = useIdleTimeout({
    timeoutMs: idleTimeoutMs,
    onIdle: lock,
    // `!== 'locked'`, NOT `=== 'open'`. A bench abandoned mid-HANDOVER still
    // holds a live token — somebody taps "switch packer" and is called away —
    // so disarming the clock there leaves the unattended shared terminal signed
    // in indefinitely, which is the leak A3 exists to close, reachable in one
    // tap. Firing `lock()` from `handover` is correct: it sets `'locked'` and
    // clears the principal, and `useIdleTimeout`'s fire-once guard stops a
    // re-fire. Nobody signed in means nothing to lock.
    enabled: signedIn && state !== 'locked',
  });

  /**
   * A fresh sign-in re-arms the clock and reopens the bench for the incoming
   * packer — without this the idle hook stays fired and the bench never locks
   * again.
   *
   * Keyed on the TRANSITION into signed-in, not on `signedIn` being true: a
   * plain truth test also fires mid-handover, where the outgoing packer is
   * still signed in, and would snap `handover` back to `open` before they could
   * confirm — i.e. delete step one of the two-step handover D13 requires.
   */
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    if (signedIn && !wasSignedIn.current) {
      setState('open');
      reset();
    }
    wasSignedIn.current = signedIn;
  }, [signedIn, reset]);

  const requestHandover = useCallback((): void => {
    setState('handover');
  }, []);

  const confirmHandover = useCallback(async (): Promise<void> => {
    // `finally`, for `lock()`'s reason: a failed logout POST must not strand
    // the bench in `handover` with a live-looking session. The local principal
    // is cleared either way by `clearPrincipal`'s own `finally`.
    try {
      await clearPrincipal();
    } finally {
      setState('locked');
    }
  }, [clearPrincipal]);

  const cancelHandover = useCallback((): void => {
    setState('open');
  }, []);

  return {
    // Signed out for any reason presents as locked: there is no fourth state,
    // and a signed-out bench showing its body would be the leak A3 forbids.
    state: signedIn ? state : 'locked',
    signedInName: session.user?.username ?? null,
    lock,
    requestHandover,
    confirmHandover,
    cancelHandover,
  };
}
