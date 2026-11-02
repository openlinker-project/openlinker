/**
 * useClampOverflow (#3539)
 *
 * Whether a line-clamped element actually has text hidden by its clamp. A
 * character count cannot answer that - it varies with font, width and line
 * breaks - so this measures: `scrollHeight` exceeds `clientHeight` only while
 * the clamp is cutting something off. It is re-measured when the element
 * resizes (a `ResizeObserver`, absent in some environments such as jsdom, where
 * the answer is simply "not overflowing") and when `deps` change.
 *
 * Measurement only means anything WHILE clamped: an expanded element never
 * overflows itself. So the last clamped answer is kept while expanded, and the
 * caller's "Show less" control does not vanish the moment it is pressed.
 *
 * @module apps/web/src/shared/hooks
 */
import { useLayoutEffect, useState, type RefObject } from 'react';

export function useClampOverflow(
  ref: RefObject<HTMLElement | null>,
  clamped: boolean,
  deps: readonly unknown[],
): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!clamped || element === null) return undefined;

    const measure = (): void => {
      // One pixel of slack: sub-pixel line heights can leave the two a hair apart.
      setOverflowing(element.scrollHeight - element.clientHeight > 1);
    };
    measure();

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
    // `deps` is the caller's re-measure trigger by design.
  }, [ref, clamped, ...deps]);

  return overflowing;
}
