/**
 * Order fulfilment-tasks panel (#2411, `W3a-21`, DESIGN §5.2)
 *
 * The order-detail surface for work-grain holds: the fulfilment tasks covering
 * this order, their counters, their holds, and the actions the SERVER says are
 * legal on each right now.
 *
 * The orders LIST is untouched by design — it renders only the order-grain
 * `activeHoldReason`. Promoting a work-hold rollup to a list signal is open
 * question §12.10 and deliberately not a column: one projection, one derivation
 * input, no second contradictory surface.
 *
 * ## Four states, and "unknown" is never reported as "none"
 *
 * A loading read renders a skeleton line; a FAILED read renders an error with a
 * Retry; a settled, successful read with no tasks says so in a sentence; only
 * then does the list render. Collapsing the first two into the empty state
 * would have this panel telling an operator their order was never routed
 * because a request timed out — a false claim, on the surface whose whole job is
 * explaining why work is stopped.
 *
 * ## The version sent is the version RENDERED
 *
 * `expectedVersion` is read off the task object the button was rendered from,
 * never re-read from the cache at click time. Substituting a fresher value would
 * make `version_conflict` unreachable and hand the last writer the win.
 *
 * @module apps/web/src/features/fulfillment/components
 */
import type { ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import { useFulfillmentTaskActionRunner } from '../hooks/use-fulfillment-task-action-runner';
import { useOrderFulfillmentTasksQuery } from '../hooks/use-order-fulfillment-tasks-query';
import { FulfillmentTaskActions } from './fulfillment-task-actions';
import { FulfillmentTaskActionDialog } from './fulfillment-task-action-dialog';
import { FulfillmentTaskCard } from './fulfillment-task-card';

export interface OrderFulfillmentTasksPanelProps {
  internalOrderId: string;
}

export function OrderFulfillmentTasksPanel({
  internalOrderId,
}: OrderFulfillmentTasksPanelProps): ReactElement {
  const query = useOrderFulfillmentTasksQuery(internalOrderId);
  // The 409 contract, the busy/pending state and the dialog submit all live in
  // the runner (#3257) — this panel was one of the two copies it replaced.
  // `resolveOrderId` keeps the panel's own id as the context field rather than
  // the task's; the two disagreed before the extraction and the field is inert
  // either way (the mutation strips it), so the difference is preserved rather
  // than quietly resolved.
  const actions = useFulfillmentTaskActionRunner({ resolveOrderId: () => internalOrderId });
  const demoMode = useDemoMode();
  // `orders:write` is held by exactly `admin` + `operator`, which is precisely
  // the action route's `@Roles('admin', 'operator')`. Deliberately WITHOUT the
  // `useIsAdmin()` conjunction `OrderHoldPanel` needs — its routes are
  // admin-only and these are not, so ANDing it in would silently hide every
  // fulfilment action from the operators the route exists to serve.
  const write = useWriteAccess('orders:write', demoMode);

  const body = ((): ReactElement => {
    if (!internalOrderId) {
      // The query is `enabled: Boolean(orderId)`, so with no id it never
      // leaves `isPending` and would report "Loading…" for ever — a fourth
      // state ("never asked") wearing the first one's clothes. Unreachable
      // from the order-detail page, and stated rather than left as a trap.
      return <p className="text-muted">No order to look fulfilment tasks up for.</p>;
    }
    if (query.isPending) {
      return <p className="text-muted">Loading fulfilment tasks…</p>;
    }
    if (query.isError) {
      // NEVER the empty state: a read that failed says nothing about whether
      // this order has fulfilment tasks.
      return (
        <Alert
          tone="error"
          action={
            <Button
              tone="secondary"
              className="button--sm"
              onClick={() => {
                void query.refetch();
              }}
            >
              Retry
            </Button>
          }
        >
          Could not load this order&rsquo;s fulfilment tasks.
        </Alert>
      );
    }

    const tasks = query.data?.works ?? [];
    if (tasks.length === 0) {
      return (
        <p className="text-muted">
          No fulfilment tasks &mdash; this order was not routed to one. That is normal unless
          fulfilment routing is switched on.
        </p>
      );
    }

    return (
      <>
        <ul className="fulfilment-task-list">
          {tasks.map((task) => (
            <FulfillmentTaskCard
              key={task.id}
              task={task}
              actions={
                <FulfillmentTaskActions
                  task={task}
                  visible={write.visible}
                  readOnly={write.demoReadOnly}
                  busy={actions.busyTaskId === task.id}
                  onInvoke={(action) => {
                    actions.run(task, action, {});
                  }}
                  onHold={() => {
                    actions.openForm({ mode: 'hold', task });
                  }}
                  onReleaseHold={(hold) => {
                    actions.openForm({ mode: 'release_hold', task, hold });
                  }}
                  onForceCancel={() => {
                    actions.openForm({ mode: 'force_cancel', task });
                  }}
                />
              }
            />
          ))}
        </ul>
        {query.data && query.data.total > tasks.length ? (
          <p className="text-muted">
            Showing {tasks.length} of {query.data.total} fulfilment tasks for this order.
          </p>
        ) : null}
      </>
    );
  })();

  return (
    <section className="detail-section" id="fulfilment-tasks" tabIndex={-1}>
      <h3 className="detail-section__title">Fulfilment tasks</h3>
      {body}

      {actions.pendingForm ? (
        <FulfillmentTaskActionDialog
          // Remount per (task, mode, hold) so a draft never carries across.
          key={`${actions.pendingForm.task.id}:${actions.pendingForm.mode}:${actions.pendingForm.hold?.id ?? ''}`}
          open
          mode={actions.pendingForm.mode}
          holdId={actions.pendingForm.hold?.id}
          submitting={actions.busyTaskId === actions.pendingForm.task.id}
          error={actions.pendingForm.error ?? null}
          onOpenChange={(open) => {
            if (!open) actions.closeForm();
          }}
          onSubmit={actions.submitForm}
        />
      ) : null}
    </section>
  );
}
