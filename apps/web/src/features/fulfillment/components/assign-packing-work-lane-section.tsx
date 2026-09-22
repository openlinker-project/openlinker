/**
 * One packer swimlane (#3340, ADR-074)
 *
 * The packer-grouped counterpart of `FulfillmentLaneSection` (#2410's
 * location/delivery-method lanes) — same dual desktop-row/card render so a
 * `DataTable`-style media query decides which is visible, reusing
 * `FulfillmentWorklistRow` / `FulfillmentTaskCard`. The `actions` slot
 * renders THIS screen's staffing controls, not the execution actions those
 * rows are normally paired with.
 *
 * ## Drag-and-drop (#3426) is wired here, additively
 *
 * The section itself is the drop target — a single `<section>` listener
 * covers everything a packer could drag onto, including its own header,
 * because React's synthetic events bubble from every descendant to it; the
 * mockup wires the header and body separately only because its plain-DOM
 * script has no bubbling story of its own. `dragOver` is local UI state
 * driving the highlight class — nothing here decides whether a drop is
 * legal, that is `AssignPackingWorkPage`'s job, which already knows the
 * dragged task's CURRENT lane and can no-op a same-lane drop.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { useState, type DragEvent, type ReactElement } from 'react';

import type { FulfillmentTask } from '../api/fulfillment.types';
import { buildFulfillmentDragSourceProps } from '../lib/assign-packing-work-drag';
import type { AssignPackingWorkLane } from '../lib/assign-packing-work-lanes';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { FulfillmentTaskCard } from './fulfillment-task-card';
import { FulfillmentWorklistRow } from './fulfillment-worklist-row';

export interface AssignPackingWorkLaneSectionProps {
  lane: AssignPackingWorkLane;
  renderActions: (task: FulfillmentTask) => ReactElement | null;
  /** Gates drag exactly like the "Move to" select's own write-access check. */
  dragEnabled: boolean;
  onTaskDragStart: (task: FulfillmentTask) => void;
  /** Fired on drop, whatever lane it lands in — the page decides legality. */
  onDropOnLane: (laneId: string) => void;
}

function laneTitle(lane: AssignPackingWorkLane): string {
  if (lane.id === 'unassigned') return ASSIGN_PACKING_WORK_COPY.lane.unassignedTitle;
  if (lane.packer) return lane.packer.username;
  return ASSIGN_PACKING_WORK_COPY.lane.offRosterTitle;
}

export function AssignPackingWorkLaneSection({
  lane,
  renderActions,
  dragEnabled,
  onTaskDragStart,
  onDropOnLane,
}: AssignPackingWorkLaneSectionProps): ReactElement {
  const title = laneTitle(lane);
  const [dragOver, setDragOver] = useState(false);

  const dropTargetProps = dragEnabled
    ? {
        onDragOver: (event: DragEvent<HTMLElement>): void => {
          // Required for `onDrop` to fire at all — a `dragover` with no
          // `preventDefault()` tells the browser this element refuses drops.
          event.preventDefault();
          setDragOver(true);
        },
        onDragLeave: (): void => {
          setDragOver(false);
        },
        onDrop: (event: DragEvent<HTMLElement>): void => {
          event.preventDefault();
          setDragOver(false);
          onDropOnLane(lane.id);
        },
      }
    : {};

  const sectionClassName = [
    'assign-packing-work-lane',
    dragOver ? 'assign-packing-work-lane--drag-over' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={sectionClassName} aria-label={title} {...dropTargetProps}>
      <header className="assign-packing-work-lane__head">
        <h3 className="assign-packing-work-lane__title">{title}</h3>
        <span className="assign-packing-work-lane__count tabular text-muted">
          {lane.tasks.length}
        </span>
      </header>

      {lane.tasks.length === 0 ? (
        <p className="text-muted">{ASSIGN_PACKING_WORK_COPY.lane.empty}</p>
      ) : (
        <>
          <ul className="fulfilment-worklist__desktop">
            {lane.tasks.map((task) => (
              <FulfillmentWorklistRow
                key={task.id}
                task={task}
                actions={renderActions(task)}
                rootProps={buildFulfillmentDragSourceProps(task, dragEnabled, onTaskDragStart)}
              />
            ))}
          </ul>

          <ul className="fulfilment-worklist__cards fulfilment-task-list">
            {lane.tasks.map((task) => (
              <FulfillmentTaskCard
                key={task.id}
                task={task}
                actions={renderActions(task)}
                rootProps={buildFulfillmentDragSourceProps(task, dragEnabled, onTaskDragStart)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
