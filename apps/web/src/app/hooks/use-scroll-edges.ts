/**
 * useScrollEdges
 *
 * Reports whether a scroll container has more content above and below its
 * visible area, so the sidebar can show its scroll arrows only where there is
 * somewhere to go. Reads geometry on scroll (one read per frame at most) and
 * when the container or its children change size; state only changes when an
 * edge flips, so scrolling does not re-render on every frame.
 *
 * @module app/hooks
 */
import { useEffect, useState, type RefObject } from 'react';

export interface ScrollEdges {
  up: boolean;
  down: boolean;
}

// Sub-pixel rounding leaves a 1 px remainder at the bottom on zoomed screens.
const EDGE_TOLERANCE_PX = 2;

export function readScrollEdges(
  el: Pick<HTMLElement, 'scrollTop' | 'scrollHeight' | 'clientHeight'>
): ScrollEdges {
  return {
    up: el.scrollTop > EDGE_TOLERANCE_PX,
    down: el.scrollHeight - el.clientHeight - el.scrollTop > EDGE_TOLERANCE_PX,
  };
}

/**
 * @param ref the scrolling element
 * @param contentKey changes when the children change, so they are re-observed
 */
export function useScrollEdges(
  ref: RefObject<HTMLElement | null>,
  contentKey: unknown
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ up: false, down: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const next = readScrollEdges(el);
      setEdges((prev) => (prev.up === next.up && prev.down === next.down ? prev : next));
    };
    const schedule = (): void => {
      if (frame === 0) {
        frame = requestAnimationFrame(measure);
      }
    };

    measure();
    el.addEventListener('scroll', schedule, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    if (resize) {
      resize.observe(el);
      for (const child of Array.from(el.children)) {
        resize.observe(child);
      }
    }
    return () => {
      el.removeEventListener('scroll', schedule);
      resize?.disconnect();
      if (frame !== 0) {
        cancelAnimationFrame(frame);
      }
    };
  }, [ref, contentKey]);

  return edges;
}
