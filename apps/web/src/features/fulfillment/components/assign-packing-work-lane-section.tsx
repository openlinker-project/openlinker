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
 * ## The avatar, load bar and accent (#3427)
 *
 * `lane.packer === null` covers both the pinned Unassigned lane AND an
 * off-roster assignee — but only the FORMER gets the warning icon and the
 * warning-toned top accent; an off-roster packer still gets an initials
 * avatar (from whatever name it has, which is none — see `laneTitle`) and
 * the ordinary accent, because it is a real (if departed) person's work,
 * not a pool. The load bar and its threshold tones are `lane.tasks.length`
 * read through `laneLoadPercent`/`laneLoadTone` — the SAME count already
 * rendered beside it, never a second, possibly-drifting source. Station and
 * online-presence text (the mockup's `lane__station`) is not rendered: it
 * needs a presence signal this system does not have yet (tracked
 * separately); rendering a fabricated "online" claim would be worse than
 * omitting the line.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import { useState, type DragEvent, type ReactElement } from 'react';

import { formatInitials } from '../../../shared/format/format-initials';
import { StatusBadge } from '../../../shared/ui/status-badge';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { buildFulfillmentDragSourceProps } from '../lib/assign-packing-work-drag';
import {
  isAssignmentOnlyCard,
  laneLoadPercent,
  laneLoadTone,
  UNASSIGNED_LANE_ID,
  type AssignPackingWorkLane,
} from '../lib/assign-packing-work-lanes';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { AssignPackingWorkCard } from './assign-packing-work-card';

export interface AssignPackingWorkLaneSectionProps {
  lane: AssignPackingWorkLane;
  renderActions: (task: FulfillmentTask) => ReactElement | null;
  /** Gates drag exactly like the "Move to" select's own write-access check. */
  dragEnabled: boolean;
  onTaskDragStart: (task: FulfillmentTask) => void;
  /** Fired on drop, whatever lane it lands in — the page decides legality. */
  onDropOnLane: (laneId: string) => void;
  /** #3427 — computed once, across every lane. See `lightestLoadLaneIds`. */
  lightestLoad: boolean;
}

function laneTitle(lane: AssignPackingWorkLane): string {
  // An axis that is not about people supplies its own heading — there is
  // nothing to derive one from. Checked FIRST so a lane whose id happens to
  // collide with the pinned one cannot borrow its title.
  if (lane.title !== undefined) return lane.title;
  if (lane.id === UNASSIGNED_LANE_ID) return ASSIGN_PACKING_WORK_COPY.lane.unassignedTitle;
  if (lane.packer) return lane.packer.username;
  return ASSIGN_PACKING_WORK_COPY.lane.offRosterTitle;
}

export function AssignPackingWorkLaneSection({
  lane,
  renderActions,
  dragEnabled,
  onTaskDragStart,
  onDropOnLane,
  lightestLoad,
}: AssignPackingWorkLaneSectionProps): ReactElement {
  const title = laneTitle(lane);
  const isUnassignedLane = lane.id === UNASSIGNED_LANE_ID;
  const [dragOver, setDragOver] = useState(false);
  const loadPercent = laneLoadPercent(lane.tasks.length);
  const loadTone = laneLoadTone(lane.tasks.length);

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

  /**
   * #3429 — merges the drag-source rootProps (#3426) with the assignment-
   * only muted class, so a row can carry both without either caller
   * overwriting the other's `className`.
   */
  const buildRootProps = (task: FulfillmentTask): ReturnType<typeof buildFulfillmentDragSourceProps> => {
    const dragProps = buildFulfillmentDragSourceProps(task, dragEnabled, onTaskDragStart);
    if (!isAssignmentOnlyCard(task)) return dragProps;
    return {
      ...dragProps,
      className: [dragProps.className, 'assign-packing-work-lane-card--assignment-only']
        .filter(Boolean)
        .join(' '),
    };
  };

  const sectionClassName = [
    'assign-packing-work-lane',
    isUnassignedLane ? 'assign-packing-work-lane--unassigned' : '',
    dragOver ? 'assign-packing-work-lane--drag-over' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={sectionClassName} aria-label={title} {...dropTargetProps}>
      <header className="assign-packing-work-lane__head">
        {isUnassignedLane ? (
          <span className="assign-packing-work-lane__icon" aria-hidden="true">
            ✳
          </span>
        ) : (
          <span className="assign-packing-work-lane__avatar" aria-hidden="true">
            {formatInitials(title)}
          </span>
        )}
        <div className="assign-packing-work-lane__identity">
          <h3 className="assign-packing-work-lane__title">
            {title}
            {lightestLoad ? (
              <StatusBadge
                tone="success"
                compact
                className="assign-packing-work-lane__lightest-tag"
              >
                {ASSIGN_PACKING_WORK_COPY.lane.lightestLoadTag}
              </StatusBadge>
            ) : null}
          </h3>
          {/* #3429 — static copy, needs no presence signal (see the module docblock). */}
          {isUnassignedLane ? (
            <p className="assign-packing-work-lane__subtitle">
              {ASSIGN_PACKING_WORK_COPY.lane.unassignedSubtitle}
            </p>
          ) : null}
        </div>
        {/* NOT on the unassigned lane — the mockup gives it no load bar, and
            the reason is that "load" is a statement about a PERSON. The pool
            is a queue; a full one means there is work to hand out, not that
            somebody is overloaded, and rendering it here painted the busiest
            possible bar across the top of a healthy board. A lane that is not
            about a person has nothing to compare. */}
        {isUnassignedLane ? null : (
          <div className="assign-packing-work-lane__load">
            <div className="assign-packing-work-lane__load-bar">
              <div
                className={`assign-packing-work-lane__load-fill assign-packing-work-lane__load-fill--${loadTone}`}
                style={{ width: `${String(loadPercent)}%` }}
              />
            </div>
          </div>
        )}
        <span className="assign-packing-work-lane__count tabular text-muted">
          {lane.tasks.length}
        </span>
      </header>

      {lane.tasks.length === 0 ? (
        <p className="text-muted">{ASSIGN_PACKING_WORK_COPY.lane.empty}</p>
      ) : (
        // The lane's rows, flush inside the lane's own border — no gap, no
        // second box. The wrapper survives the column heads it was added for
        // because it is still what keeps the list's corners meeting the
        // lane's.
        <div className="assign-packing-work-lane__table">
          {/* NO column heads. `.lane__col-heads` exists in the mockup's CSS and
              its markup never instantiates it — a lane is a list of rows, not a
              table, and a heading strip over four-word rows read as a table
              somebody had half-built. The columns are legible from the rows
              themselves: a mono reference, a badge, a name, a muted summary. */}
          {/* ONE list at every width (#3401). The dual desktop-row/mobile-card
             pair here was `FulfillmentWorklistRow` + `FulfillmentTaskCard`,
             borrowed from the EXECUTION worklist - and on a phone that card
             stacked every column as a label/value pair, so a supervisor saw a
             screenful of `ol_location_...` and `ol_variant_...` per task. This
             board's card reflows instead of swapping, because the question is
             the same on a phone as on a desk. */}
          <ul className="assign-packing-work-card-list">
            {lane.tasks.map((task) => (
              <AssignPackingWorkCard
                key={task.id}
                task={task}
                actions={renderActions(task)}
                rootProps={buildRootProps(task)}
                dragEnabled={dragEnabled}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
