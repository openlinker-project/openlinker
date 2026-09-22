/**
 * Native HTML5 drag-and-drop source props for the Assign Packing Work board
 * (#3426)
 *
 * A PURE function, deliberately not a hook — it is called per row inside a
 * `.map()` in `AssignPackingWorkLaneSection`, where a `use*` hook would
 * violate the rules of hooks (a variable call count across renders). It
 * reads and calls nothing React-specific; it only builds the plain object
 * `FulfillmentWorklistRow`/`FulfillmentTaskCard`'s `rootProps` spreads onto
 * their own root `<li>`.
 *
 * ## Additive, never a replacement (mockup's own accessibility framing)
 *
 * The "Move to" select stays the primary, keyboard-reachable path — this is
 * a mouse-only shortcut layered on top of it, so `enabled` gates it exactly
 * like the select's own write-access check, never independently.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import type { DragEvent, LiHTMLAttributes } from 'react';

import type { FulfillmentTask } from '../api/fulfillment.types';

/**
 * The dedicated MIME type carrying the dragged task's id.
 *
 * Read by nothing — the ACTUAL identity of the dragged task is lifted to
 * React state on `AssignPackingWorkPage` (the issue's own decision: a
 * mutable module-level var is not safe across React re-renders). This is
 * set anyway because a `dragstart` with no `dataTransfer.setData` call
 * leaves some browsers refusing to fire `drop` at all.
 */
export const FULFILLMENT_TASK_DRAG_MIME_TYPE = 'application/x-openlinker-fulfillment-task';

export function buildFulfillmentDragSourceProps(
  task: FulfillmentTask,
  enabled: boolean,
  onDragStart: (task: FulfillmentTask) => void
): LiHTMLAttributes<HTMLLIElement> {
  if (!enabled) return {};

  return {
    draggable: true,
    className: 'assign-packing-work-draggable',
    onDragStart: (event: DragEvent<HTMLLIElement>) => {
      event.dataTransfer.setData(FULFILLMENT_TASK_DRAG_MIME_TYPE, task.id);
      event.dataTransfer.effectAllowed = 'move';
      onDragStart(task);
    },
  };
}
