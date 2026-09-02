/**
 * One fulfilment task, desktop row (#2410)
 *
 * The wide-viewport counterpart of `FulfillmentTaskCard`. It composes the SAME
 * `FulfillmentTaskActions` the card and the order-detail panel use, which is
 * what makes "no client-side state machine" structurally true rather than
 * separately argued: there is one component that turns `supportedActions` into
 * controls, and this row hands it the task unchanged.
 *
 * ## This row decides NOTHING about legality
 *
 * It does not read `status`, it does not read `requestStatus`, it does not read
 * a counter, and it does not filter `supportedActions` — not even to drop an
 * action that "obviously" cannot apply. The server offers `hold` on a task that
 * already carries a hold precisely when a second hold is legal; suppressing it
 * here would be this surface overruling the only party that knows (DESIGN
 * §5.2). `scripts/check-no-supported-actions-mirror.mjs` catches the two
 * declaration shapes and says plainly that it cannot catch an inline
 * `if (status === …)`, so the rule is honoured here rather than merely enforced.
 *
 * ## Heldness is `activeHolds`, and the counters are display-only
 *
 * Both rules are the card's (#2411) and are restated in the rendering, not
 * re-derived: nothing writes `status = 'on_hold'`, and `recordLineProgress`
 * moves a counter without bumping `version` (#2400).
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { holdReasonLabel } from '../../orders';
import type { FulfillmentTask } from '../api/fulfillment.types';
import {
  fulfillmentRequestStatusLabel,
  fulfillmentStatusLabel,
} from '../lib/fulfillment-task.copy';
import { FULFILLMENT_WORKLIST_COPY } from '../lib/fulfillment-worklist.copy';

export interface FulfillmentWorklistRowProps {
  task: FulfillmentTask;
  /** The action controls, composed by the page (which owns the dialogs). */
  actions?: ReactElement | null;
}

export function FulfillmentWorklistRow({
  task,
  actions,
}: FulfillmentWorklistRowProps): ReactElement {
  const held = task.activeHolds.length > 0;

  const fulfilled = task.lines.reduce((sum, line) => sum + line.fulfilledQuantity, 0);
  const total = task.lines.reduce((sum, line) => sum + line.totalQuantity, 0);

  return (
    <li className="fulfilment-worklist-row" data-held={held ? 'true' : 'false'}>
      <div className="fulfilment-worklist-row__identity">
        <span className="fulfilment-worklist-row__id mono-text" title={task.id}>
          {task.id}
        </span>
        <span className="fulfilment-worklist-row__order mono-text text-muted" title={task.orderId}>
          {task.orderId}
        </span>
      </div>

      <div className="fulfilment-worklist-row__state">
        {held ? (
          task.activeHolds.map((hold) => (
            <StatusBadge key={hold.id} tone="warning" withDot compact>
              {`On hold — ${holdReasonLabel(hold.reason)}`}
            </StatusBadge>
          ))
        ) : (
          <StatusBadge tone="info" compact>
            {fulfillmentStatusLabel(task.status)}
          </StatusBadge>
        )}
        {/* Rendered even under a hold badge, so the underlying state is never
            hidden by it — "held" and "scheduled" are both true at once. */}
        <span className="fulfilment-worklist-row__substate text-muted">
          {fulfillmentStatusLabel(task.status)} · {fulfillmentRequestStatusLabel(task.requestStatus)}
        </span>
      </div>

      <div className="fulfilment-worklist-row__lines tabular">
        {task.lines.length > 0
          ? FULFILLMENT_WORKLIST_COPY.row.lineCount(fulfilled, total)
          : FULFILLMENT_WORKLIST_COPY.row.noLines}
      </div>

      <div className="fulfilment-worklist-row__actions">{actions}</div>
    </li>
  );
}
