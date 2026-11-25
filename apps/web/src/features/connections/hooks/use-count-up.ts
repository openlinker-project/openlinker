/**
 * Count-up hook
 *
 * Eases a displayed whole number from its previous value to `target`, so a
 * figure that just arrived reads as new information instead of popping in
 * (#4228). It animates only where the user allows motion: with
 * `prefers-reduced-motion`, or where `matchMedia` is absent (tests, old
 * browsers), the target is returned unchanged and nothing is scheduled.
 *
 * @module features/connections/hooks
 */
import { useEffect, useRef, useState } from 'react';

function motionAllowed(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    typeof requestAnimationFrame === 'function' &&
    window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  );
}

export function useCountUp(target: number, durationMs = 650): number {
  const allowed = motionAllowed();
  const [value, setValue] = useState<number>(allowed ? 0 : target);
  const from = useRef<number>(allowed ? 0 : target);

  useEffect(() => {
    if (!motionAllowed()) {
      setValue(target);
      from.current = target;
      return undefined;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number): void => {
      const progress = Math.min((now - start) / durationMs, 1);
      // Ease-out cubic: fast at first, settling on the real number.
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(origin + (target - origin) * eased);
      setValue(next);
      from.current = next;
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}
