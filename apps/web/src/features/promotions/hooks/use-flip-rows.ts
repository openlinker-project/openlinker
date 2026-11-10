/**
 * Row move motion (#3935)
 *
 * When the order of a table's rows changes, each row slides from where it was to
 * where it is now (the FLIP technique: measure first, last, invert, play), so
 * the eye follows the row that moved instead of watching two rows swap. Rows are
 * found by `data-id`; nothing happens with reduced motion.
 *
 * @module apps/web/src/features/promotions/hooks
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';

const MOVE_MS = 320;

export function useFlipRows(containerRef: RefObject<HTMLElement | null>, orderKey: string): void {
  const previous = useRef<Map<string, number>>(new Map());
  const lastKey = useRef(orderKey);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>('tr[data-id]'));
    const next = new Map(rows.map((row) => [row.dataset.id ?? '', row.getBoundingClientRect().top]));
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!reduce && lastKey.current !== orderKey) {
      for (const row of rows) {
        const id = row.dataset.id ?? '';
        const before = previous.current.get(id);
        const after = next.get(id);
        if (before === undefined || after === undefined || before === after) continue;
        row.animate?.(
          [{ transform: `translateY(${before - after}px)` }, { transform: 'translateY(0)' }],
          { duration: MOVE_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
        );
      }
    }
    lastKey.current = orderKey;
    previous.current = next;
  });
}
