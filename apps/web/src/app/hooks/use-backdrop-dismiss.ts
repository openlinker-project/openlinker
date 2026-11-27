/**
 * useBackdropDismiss
 *
 * Closes a modal `<dialog>` when the operator clicks its dimmed backdrop. A
 * click on `::backdrop` is delivered to the dialog element itself, with the
 * point outside the dialog's box, so that is the test. The press must also
 * START on the backdrop: a click is dispatched to the common ancestor of the
 * press and release targets, so a text selection dragged out of the panel and
 * released over the backdrop would otherwise close it.
 *
 * Pointer shortcut only; Escape and the dialog's own close control cover the
 * keyboard.
 *
 * @module app/hooks
 */
import { useCallback, useRef, type MouseEvent, type PointerEvent } from 'react';

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function isOutsideBox(box: Box, x: number, y: number): boolean {
  return x < box.left || x > box.right || y < box.top || y > box.bottom;
}

function isBackdropHit(event: MouseEvent<HTMLDialogElement>): boolean {
  return (
    event.target === event.currentTarget &&
    isOutsideBox(event.currentTarget.getBoundingClientRect(), event.clientX, event.clientY)
  );
}

export function useBackdropDismiss(): {
  onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void;
  onClick: (event: MouseEvent<HTMLDialogElement>) => void;
} {
  const pressedOnBackdrop = useRef(false);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDialogElement>): void => {
    pressedOnBackdrop.current = isBackdropHit(event);
  }, []);

  const onClick = useCallback((event: MouseEvent<HTMLDialogElement>): void => {
    const startedOnBackdrop = pressedOnBackdrop.current;
    pressedOnBackdrop.current = false;
    if (startedOnBackdrop && isBackdropHit(event)) {
      event.currentTarget.close();
    }
  }, []);

  return { onPointerDown, onClick };
}
