/**
 * Idle-timeout hook (#2413, story A3)
 *
 * > *Given I stop interacting, then the surface locks after an idle period, and
 * > no scan is attributed to me until someone signs in; locking never discards
 * > progress.*
 *
 * Fires `onIdle` once per idle period. Any pointer, key, scroll or touch
 * activity — plus the tab becoming visible again — restarts the clock.
 *
 * ## Four properties worth knowing
 *
 * 1. **It fires ONCE per idle period**, not repeatedly. `onIdle` is what clears
 *    a session at a shared bench; firing it every tick afterwards would clear
 *    an already-cleared session on a loop. Re-arm with `reset()` after the
 *    surface is unlocked.
 * 2. **`enabled: false` disarms and clears the timer**, so an already-locked
 *    surface cannot re-lock itself, and a surface with nobody signed in does
 *    not run a timer for no reason.
 * 3. **Nothing is persisted.** No `localStorage`, no `sessionStorage` — an idle
 *    deadline written to shared browser storage on a shared terminal is one
 *    more thing an incoming packer inherits, and `no-localstorage-jwt.test.ts`
 *    already guards the neighbourhood.
 * 4. **`onIdle` is held in a ref**, so an inline arrow at the call site does not
 *    re-arm the timer on every render — which would make the surface never lock
 *    on a component that re-renders faster than the timeout.
 *
 * Listeners are `passive` and on `window` with capture, so activity inside a
 * modal or an overlay still counts.
 *
 * @module apps/web/src/shared/hooks
 */
import { useCallback, useEffect, useRef } from 'react';

/** Events that count as "the packer is still here". */
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
  'scroll',
] as const;

export interface UseIdleTimeoutOptions {
  /** Milliseconds of inactivity before `onIdle` fires. */
  readonly timeoutMs: number;
  /** Called once when the idle period elapses. */
  readonly onIdle: () => void;
  /** When false the timer is cleared and no listeners are attached. */
  readonly enabled?: boolean;
}

export interface UseIdleTimeoutResult {
  /** Restart the clock and re-arm a hook that has already fired. */
  readonly reset: () => void;
}

export function useIdleTimeout({
  timeoutMs,
  onIdle,
  enabled = true,
}: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const arm = useCallback((): void => {
    clear();
    // Once fired, stay fired until `reset()` — see property (1).
    if (firedRef.current) return;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      timerRef.current = null;
      onIdleRef.current();
    }, timeoutMs);
  }, [clear, timeoutMs]);

  const reset = useCallback((): void => {
    firedRef.current = false;
    arm();
  }, [arm]);

  useEffect(() => {
    if (!enabled) {
      clear();
      return;
    }

    arm();

    const onActivity = (): void => {
      // Activity does NOT un-fire an elapsed timeout: once the surface has
      // locked, a stray pointermove from someone walking past must not unlock
      // it. `arm()` no-ops while `firedRef` is set.
      arm();
    };
    const onVisibility = (): void => {
      if (!document.hidden) onActivity();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, onActivity, { passive: true, capture: true });
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, onActivity, { capture: true });
      }
      document.removeEventListener('visibilitychange', onVisibility);
      clear();
    };
  }, [enabled, arm, clear]);

  return { reset };
}
