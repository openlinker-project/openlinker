/**
 * One worklist lane (#2410)
 *
 * A heading (where the goods are, how they leave) plus that lane's tasks
 * rendered TWICE — as desktop rows and as cards — with a CSS media query
 * deciding which is visible. That is the house pattern (`DataTable`'s own
 * `cardView`), and it is what lets the two surfaces be asserted to show the
 * same set of tasks: they are built from one array in one render.
 *
 * ## The `actions` slot is a FUNCTION of the task, not a node
 *
 * Both surfaces need their own element instance for the same task (one element
 * cannot be in two places), and the dialog state lives on the page. So the page
 * passes a renderer and this component calls it once per task per surface —
 * which also means the two surfaces cannot be handed different action sets.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import type { FulfillmentTask } from '../api/fulfillment.types';
import type { FulfillmentLane } from '../lib/fulfillment-lanes';
import { summariseLaneLines } from '../lib/fulfillment-lanes';
import { FULFILLMENT_WORKLIST_COPY } from '../lib/fulfillment-worklist.copy';
import { FulfillmentTaskCard } from './fulfillment-task-card';
import { FulfillmentWorklistRow } from './fulfillment-worklist-row';

export interface FulfillmentLaneSectionProps {
  lane: FulfillmentLane;
  /** Builds the action strip for one task. Called once per surface. */
  renderActions: (task: FulfillmentTask) => ReactElement | null;
}

export function FulfillmentLaneSection({
  lane,
  renderActions,
}: FulfillmentLaneSectionProps): ReactElement {
  const lines = summariseLaneLines(lane);

  return (
    // Both axes in the accessible name: two lanes at one location differing
    // only by delivery method would otherwise be indistinguishable to a screen
    // reader listing the page's regions.
    <section
      className="fulfilment-worklist-lane"
      aria-label={`${lane.locationLabel} — ${lane.deliveryMethodLabel}`}
    >
      <header className="fulfilment-worklist-lane__head">
        <h3 className="fulfilment-worklist-lane__title">{lane.locationLabel}</h3>
        <span className="fulfilment-worklist-lane__method text-muted">{lane.deliveryMethodLabel}</span>
        <span className="fulfilment-worklist-lane__count tabular text-muted">
          {FULFILLMENT_WORKLIST_COPY.row.lineCount(lines.fulfilled, lines.total)}
        </span>
      </header>
      {/* Said per lane rather than per row: the rows are a paged slice, so a
          lane is never the whole lane. */}
      <p className="fulfilment-worklist-lane__scope text-muted">
        {FULFILLMENT_WORKLIST_COPY.lane.pageScopeNote} {FULFILLMENT_WORKLIST_COPY.row.countersCaveat}
      </p>

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
    </section>
  );
}
