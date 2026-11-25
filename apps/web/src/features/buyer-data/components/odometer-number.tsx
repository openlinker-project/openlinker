/**
 * Odometer Number (#4289)
 *
 * A figure whose digits ROLL to their new value (reels sliding in CSS, so no
 * per-frame React work) and that gets a brief tint, so the eye catches which
 * number a handle just moved. With `delta` it also pops a small "+120 / -37"
 * chip beside the figure that fades after a moment. The reels are drawn by CSS
 * (`.odo__col::before`), so the text content stays the plain number for screen
 * readers and tests. Under reduced motion the CSS stops the rolling and the
 * chip's pop; the tint (colour only) stays.
 *
 * @module apps/web/src/features/buyer-data/components
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { formatDelta, splitOdometer } from '../lib/odometer';

export interface OdometerNumberProps {
  value: number;
  format: (n: number) => string;
  /** Show the change as a chip next to the figure. */
  delta?: boolean;
}

/** The shortest gap between two visible changes: a drag fires many values, the figure settles. */
export const ODOMETER_MIN_GAP_MS = 250;

/** Leading + trailing coalescing: a change after a quiet spell shows at once, a burst shows its last value. */
function useCoalesced(value: number): number {
  const [shown, setShown] = useState(value);
  const lastApplied = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    if (value === shown) return undefined;
    const wait = lastApplied.current + ODOMETER_MIN_GAP_MS - performance.now();
    const apply = (): void => {
      lastApplied.current = performance.now();
      setShown(value);
    };
    if (wait <= 0) {
      apply();
      return undefined;
    }
    const timer = setTimeout(apply, wait);
    return () => clearTimeout(timer);
  }, [value, shown]);
  return shown;
}

export function OdometerNumber({
  value: target,
  format,
  delta = false,
}: OdometerNumberProps): ReactElement {
  const value = useCoalesced(target);
  const [seen, setSeen] = useState(value);
  const [pulses, setPulses] = useState(0);
  const [chip, setChip] = useState<string | null>(null);
  if (seen !== value) {
    setSeen(value);
    setPulses((count) => count + 1);
    setChip(delta ? formatDelta(seen, value, format) : null);
  }

  return (
    <span key={pulses} className={pulses > 0 ? 'odo odo--pulse' : 'odo'}>
      {splitOdometer(format(value)).map((column) =>
        column.digit === null ? (
          <span key={column.key} className="odo__char">
            {column.char}
          </span>
        ) : (
          <span
            key={column.key}
            className="odo__col"
            style={{ '--digit': column.digit } as CSSProperties}
          >
            <span className="odo__sr">{column.char}</span>
          </span>
        )
      )}
      {chip !== null ? (
        <span className="odo__delta" aria-hidden="true" data-testid="odo-delta">
          {chip}
        </span>
      ) : null}
    </span>
  );
}
