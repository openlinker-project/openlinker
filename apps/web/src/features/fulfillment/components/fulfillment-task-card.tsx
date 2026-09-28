/**
 * One fulfilment task (#2411)
 *
 * ## Heldness comes from `activeHolds`, NOT from `status`
 *
 * Nothing in the backend writes `status = 'on_hold'` (#2406), so a held task
 * reads `status: 'open'` with a non-empty `activeHolds`. Rendering the status
 * alone would print **Open** across a task that is suspended — which is the
 * single most misleading thing this panel could say, since explaining why work
 * is stopped is the reason it exists. So the held badge leads, and the raw
 * orchestration status is demoted to a secondary label rather than dropped
 * (an operator still needs to see `scheduled` vs `in_progress` under a hold).
 *
 * ## The hold's actor is not rendered, because it is not projected
 *
 * `FulfillmentHoldView` withholds `placedByService` as an internal actor and
 * carries no `placedByUserId` (#2406). Rendering only the user arm of the
 * `CHK_fulfillment_holds_actor` XOR would attribute every service-placed hold
 * to nobody, and inventing one is worse. This surface says what was asked and
 * when, and stays silent about who. Follow-up, not an omission.
 *
 * ## The counters are DISPLAY-ONLY
 *
 * `recordLineProgress` does not bump the header `version` (#2400), so a counter
 * can move under a client holding a valid token. They are stated as such and
 * nothing is gated on one.
 *
 * ## `rootProps` is a generic passthrough, never drag-specific (#3426)
 *
 * Same seam and same reason as the assign board's own card docblock — see
 * there for why nesting a wrapper `<li>` is not the right shape.
 *
 * ## The expedited badge decides nothing (#3247)
 *
 * `expeditedAt` says a task was pushed ahead of deadline order (#2416). It is
 * rendered and never read for a decision: which expedite verb is offered
 * comes from `supportedActions` alone.
 *
 * ## The id is a LINK to the detail page (#3096/#3259)
 *
 * This card is only ever mounted inside `order-fulfillment-tasks-panel.tsx`,
 * which has no worklist position of its own to carry forward — an order page
 * is not a filtered list — so the link carries no query string, unlike the
 * assign board's own reference link (`fulfilmentWorkDetailPath`).
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { LiHTMLAttributes, ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { StatusBadge } from '../../../shared/ui/status-badge';
import { TimeDisplay } from '../../../shared/ui/time-display';
import { holdReasonLabel } from '../../orders';
import type { FulfillmentTask } from '../api/fulfillment.types';
import {
  FULFILLMENT_EXPEDITED_BADGE,
  fulfillmentRequestStatusLabel,
  fulfillmentStatusLabel,
} from '../lib/fulfillment-task.copy';
import { fulfillmentWorkDetailPath } from '../lib/fulfillment-filters';

export interface FulfillmentTaskCardProps {
  task: FulfillmentTask;
  /** The action controls, composed by the panel (which owns the dialogs). */
  actions?: ReactElement | null;
  /** Spread onto the root `<li>` — see the module docblock. */
  rootProps?: LiHTMLAttributes<HTMLLIElement>;
}

export function FulfillmentTaskCard({
  task,
  actions,
  rootProps,
}: FulfillmentTaskCardProps): ReactElement {
  const held = task.activeHolds.length > 0;

  return (
    <li
      {...rootProps}
      className={['fulfilment-task', rootProps?.className].filter(Boolean).join(' ')}
      data-held={held ? 'true' : 'false'}
    >
      <div className="fulfilment-task__head">
        <div className="fulfilment-task__badges">
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
          {/* After the hold/state badge, never before it — the badge above
              leads. Display only; see the module docblock. */}
          {(task.expeditedAt ?? null) !== null ? (
            <StatusBadge tone="warning" withDot compact>
              {FULFILLMENT_EXPEDITED_BADGE}
            </StatusBadge>
          ) : null}
        </div>
        <Link
          to={fulfillmentWorkDetailPath(task.id, new URLSearchParams())}
          className="fulfilment-task__id link mono-text"
          title={task.id}
        >
          {task.id}
        </Link>
      </div>

      {held ? (
        <ul className="fulfilment-task__holds">
          {task.activeHolds.map((hold) => (
            <li key={hold.id} className="text-muted">
              {holdReasonLabel(hold.reason)} · since{' '}
              <TimeDisplay iso={hold.placedAt} format="relative" />
              {hold.note ? ` — ${hold.note}` : ''}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="fulfilment-task__facts">
        {/* Rendered even when a hold leads, so the underlying state is never
            hidden by the hold badge — "held" and "scheduled" are both true. */}
        <div>
          <dt>State</dt>
          <dd>{fulfillmentStatusLabel(task.status)}</dd>
        </div>
        <div>
          <dt>Handshake</dt>
          <dd>{fulfillmentRequestStatusLabel(task.requestStatus)}</dd>
        </div>
        {task.locationId ? (
          <div>
            <dt>Location</dt>
            <dd className="mono-text">{task.locationId}</dd>
          </div>
        ) : null}
        {task.deliveryMethod ? (
          <div>
            <dt>Delivery</dt>
            <dd>{task.deliveryMethod}</dd>
          </div>
        ) : null}
        {task.externalWorkId ? (
          <div>
            <dt>External reference</dt>
            <dd className="mono-text">{task.externalWorkId}</dd>
          </div>
        ) : null}
      </dl>

      {task.lines.length > 0 ? (
        <>
          <ul className="fulfilment-task__lines">
            {task.lines.map((line) => (
              <li key={line.id}>
                <span className="mono-text">{line.productVariantId}</span>
                <span className="fulfilment-task__count">
                  {line.fulfilledQuantity} / {line.totalQuantity}
                  {line.cancelledQuantity > 0 ? ` (${line.cancelledQuantity} cancelled)` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="fulfilment-task__note text-muted">
            Picked counts are reported by whoever is working the task and can be a little behind
            what you see here.
          </p>
        </>
      ) : (
        <p className="text-muted">This fulfilment task covers no lines.</p>
      )}

      {actions}
    </li>
  );
}
