/**
 * One packer swimlane (#3340, ADR-074)
 *
 * The packer-grouped counterpart of `FulfillmentLaneSection` (#2410's
 * location/delivery-method lanes) — same dual desktop-row/card render so a
 * `DataTable`-style media query decides which is visible, reusing
 * `FulfillmentWorklistRow` / `FulfillmentTaskCard` unchanged. The `actions`
 * slot renders THIS screen's staffing controls, not the execution actions
 * those rows are normally paired with.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import type { FulfillmentTask } from '../api/fulfillment.types';
import type { AssignPackingWorkLane } from '../lib/assign-packing-work-lanes';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { FulfillmentTaskCard } from './fulfillment-task-card';
import { FulfillmentWorklistRow } from './fulfillment-worklist-row';

export interface AssignPackingWorkLaneSectionProps {
  lane: AssignPackingWorkLane;
  renderActions: (task: FulfillmentTask) => ReactElement | null;
}

function laneTitle(lane: AssignPackingWorkLane): string {
  if (lane.id === 'unassigned') return ASSIGN_PACKING_WORK_COPY.lane.unassignedTitle;
  if (lane.packer) return lane.packer.username;
  return ASSIGN_PACKING_WORK_COPY.lane.offRosterTitle;
}

export function AssignPackingWorkLaneSection({
  lane,
  renderActions,
}: AssignPackingWorkLaneSectionProps): ReactElement {
  const title = laneTitle(lane);

  return (
    <section className="assign-packing-work-lane" aria-label={title}>
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
              <FulfillmentWorklistRow key={task.id} task={task} actions={renderActions(task)} />
            ))}
          </ul>

          <ul className="fulfilment-worklist__cards fulfilment-task-list">
            {lane.tasks.map((task) => (
              <FulfillmentTaskCard key={task.id} task={task} actions={renderActions(task)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
