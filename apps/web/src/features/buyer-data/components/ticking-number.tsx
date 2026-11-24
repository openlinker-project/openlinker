/**
 * Ticking Number (#4289)
 *
 * A figure that counts to its new value when it changes (about 220 ms, ease-out)
 * and gets a brief tint pulse, so the eye catches WHICH number a handle just
 * moved. The first value is shown as is. Where motion is reduced, or the
 * environment cannot tell, the figure simply changes: the count is decoration,
 * never the way the value is conveyed.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { TICK_DURATION_MS, tickValue } from '../lib/ticking-number';

function canAnimate(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export interface TickingNumberProps {
  value: number;
  format: (n: number) => string;
}

export function TickingNumber({ value, format }: TickingNumberProps): ReactElement {
  const [shown, setShown] = useState(value);
  const [pulses, setPulses] = useState(0);
  const displayed = useRef(value);

  useEffect(() => {
    if (displayed.current === value) return undefined;
    setPulses((count) => count + 1);
    if (!canAnimate()) {
      displayed.current = value;
      setShown(value);
      return undefined;
    }
    const origin = displayed.current;
    const startedAt = performance.now();
    let frame = 0;
    const step = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / TICK_DURATION_MS);
      const next = tickValue(origin, value, progress);
      displayed.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return (
    <span key={pulses} className={pulses > 0 ? 'ticker ticker--pulse' : 'ticker'}>
      {format(shown)}
    </span>
  );
}
