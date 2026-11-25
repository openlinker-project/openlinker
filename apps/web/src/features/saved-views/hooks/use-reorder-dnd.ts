/**
 * useReorderDnd
 *
 * Reordering with the native HTML5 drag-and-drop API for the mouse, plus
 * Arrow Up / Arrow Down on the grip for the keyboard. The up/down buttons live
 * in the component; all three paths end in the same `move`.
 *
 * Native DnD does not run on touch screens, which is why the buttons are always
 * visible there (WCAG 2.2 SC 2.5.7 asks for a non-dragging alternative).
 *
 * @module apps/web/src/features/saved-views/hooks
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';

const FLASH_MS = 700;

export interface ReorderDnd {
  /** Moves an item and flashes its new row. Out-of-range targets are ignored by the caller's `onMove`. */
  move: (from: number, to: number) => void;
  /** Props for a draggable row. */
  rowProps: (index: number) => {
    draggable: true;
    onDragStart: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  /** Modifier classes for a row: flashing, being dragged, drop indicator. */
  rowClass: (index: number, base: string) => string;
  /** Arrow Up / Down on the grip. */
  gripKeyDown: (index: number) => (event: KeyboardEvent<HTMLElement>) => void;
}

export function useReorderDnd(onMove: (from: number, to: number) => void): ReorderDnd {
  const [from, setFrom] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const end = useCallback(() => {
    setFrom(null);
    setOver(null);
  }, []);

  const move = useCallback(
    (source: number, target: number) => {
      onMove(source, target);
      setFlash(target);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), FLASH_MS);
    },
    [onMove],
  );

  return {
    move,
    rowProps: (index) => ({
      draggable: true,
      onDragStart: (event) => {
        setFrom(index);
        event.dataTransfer.effectAllowed = 'move';
        try {
          event.dataTransfer.setData('text/plain', String(index));
        } catch {
          // Some engines refuse setData during a synthetic drag; the index in state is what drop reads.
        }
      },
      onDragOver: (event) => {
        if (from === null) return;
        event.preventDefault();
        setOver(index);
      },
      onDrop: (event) => {
        event.preventDefault();
        if (from !== null && from !== index) move(from, index);
        end();
      },
      onDragEnd: end,
    }),
    rowClass: (index, base) =>
      [
        base,
        flash === index ? `${base}--flash` : '',
        from === index ? `${base}--dragging` : '',
        over === index && from !== null && from !== index
          ? from < index
            ? `${base}--drop-after`
            : `${base}--drop-before`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    gripKeyDown: (index) => (event) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(index, index - 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(index, index + 1);
      }
    },
  };
}
