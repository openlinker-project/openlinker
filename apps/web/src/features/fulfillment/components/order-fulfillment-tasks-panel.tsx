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
import { useState, type ReactElement } from 'react';

import { Alert } from '../../../shared/ui/alert';
import { Button } from '../../../shared/ui/button';
import { useToast } from '../../../shared/ui/toast-provider';
import { useWriteAccess } from '../../../shared/auth/use-permission';
import { useDemoMode } from '../../system';
import type {
  ApplyFulfillmentTaskActionRequest,
  FulfillmentTask,
  FulfillmentTaskHold,
} from '../api/fulfillment.types';
import { useFulfillmentTaskActionMutation } from '../hooks/use-fulfillment-task-action-mutation';
import { useOrderFulfillmentTasksQuery } from '../hooks/use-order-fulfillment-tasks-query';
import {
  describeFulfillmentActionError,
  readFulfillmentConflict,
} from '../lib/fulfillment-conflict';
import { fulfillmentActionLabel } from '../lib/fulfillment-task.copy';
import { FulfillmentTaskActions } from './fulfillment-task-actions';
import {
  FulfillmentTaskActionDialog,
  type FulfillmentTaskActionMode,
} from './fulfillment-task-action-dialog';
import { FulfillmentTaskCard } from './fulfillment-task-card';

export interface OrderFulfillmentTasksPanelProps {
  internalOrderId: string;
}

interface PendingForm {
  mode: FulfillmentTaskActionMode;
  task: FulfillmentTask;
  hold?: FulfillmentTaskHold;
  /**
   * The failure of THIS form's own submit, if it has had one.
   *
   * Deliberately not `mutation.error`: one mutation object serves every task
   * and every mode, so a dismissed force-cancel failure on task A was still
   * `isError` when the hold dialog opened on task B — the dialog rendered
   * "Could not put this fulfilment task on hold" before anything was
   * submitted. A fabricated failure is the worst possible output from a panel
   * whose job is explaining why work is stopped, so the error is scoped to the
   * form that earned it and dies with it.
   */
  error?: unknown;
}

export function OrderFulfillmentTasksPanel({
  internalOrderId,
}: OrderFulfillmentTasksPanelProps): ReactElement {
  const query = useOrderFulfillmentTasksQuery(internalOrderId);
  const mutation = useFulfillmentTaskActionMutation();
  const { showToast } = useToast();
  const demoMode = useDemoMode();
  // `orders:write` is held by exactly `admin` + `operator`, which is precisely
  // the action route's `@Roles('admin', 'operator')`. Deliberately WITHOUT the
  // `useIsAdmin()` conjunction `OrderHoldPanel` needs — its routes are
  // admin-only and these are not, so ANDing it in would silently hide every
  // fulfilment action from the operators the route exists to serve.
  const write = useWriteAccess('orders:write', demoMode);

  const [pendingForm, setPendingForm] = useState<PendingForm | null>(null);
  /** Which task has an action in flight — so only its controls disable. */
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const run = (
    task: FulfillmentTask,
    action: string,
    body: Omit<ApplyFulfillmentTaskActionRequest, 'expectedVersion'>,
    onDone?: () => void,
    /**
     * Present on the dialog path. A failure the dialog will render as its own
     * Alert is NOT also toasted — the operator is still in the form and the
     * remedy is usually in it (the `PlaceOrderHoldDialog` precedent). A
     * conflict is the exception: the form closes, so the toast is the signal.
     */
    onFailure?: (error: unknown) => void
  ): void => {
    setBusyTaskId(task.id);
    mutation.mutate(
      {
        workId: task.id,
        action,
        orderId: internalOrderId,
        // The token as RENDERED — see the module docblock.
        expectedVersion: task.version,
        ...body,
      },
      {
        onSuccess: () => {
          showToast({ tone: 'success', description: `${fulfillmentActionLabel(action)} applied.` });
          onDone?.();
        },
        onError: (error) => {
          const conflict = readFulfillmentConflict(error);
          // A version conflict is retryable against the REFRESHED task, so the
          // form closes and the operator re-reads. Keeping it open would invite
          // a resubmit carrying the same stale token.
          const closesTheForm = conflict !== null || onFailure === undefined;
          if (closesTheForm) {
            showToast({
              // A stale token is the guard working, not a fault: the surface
              // has already refreshed itself and the operator can simply look
              // again. An illegal action, and every other failure, is an error.
              tone: conflict?.retryable === true ? 'warning' : 'error',
              description: describeFulfillmentActionError(
                error,
                `Could not ${fulfillmentActionLabel(action).toLowerCase()} this fulfilment task.`
              ),
            });
          }
          if (conflict) {
            onDone?.();
            return;
          }
          onFailure?.(error);
        },
        onSettled: () => {
          setBusyTaskId(null);
        },
      }
    );
  };

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
                  busy={busyTaskId === task.id}
                  onInvoke={(action) => {
                    run(task, action, {});
                  }}
                  onHold={() => {
                    setPendingForm({ mode: 'hold', task });
                  }}
                  onReleaseHold={(hold) => {
                    setPendingForm({ mode: 'release_hold', task, hold });
                  }}
                  onForceCancel={() => {
                    setPendingForm({ mode: 'force_cancel', task });
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

      {pendingForm ? (
        <FulfillmentTaskActionDialog
          // Remount per (task, mode, hold) so a draft never carries across.
          key={`${pendingForm.task.id}:${pendingForm.mode}:${pendingForm.hold?.id ?? ''}`}
          open
          mode={pendingForm.mode}
          holdId={pendingForm.hold?.id}
          submitting={busyTaskId === pendingForm.task.id}
          error={pendingForm.error ?? null}
          onOpenChange={(open) => {
            if (!open) setPendingForm(null);
          }}
          onSubmit={(actionBody) => {
            // Clear this form's previous failure on resubmit, so a corrected
            // note does not keep the old Alert on screen while it is in flight.
            setPendingForm((current) => (current ? { ...current, error: undefined } : current));
            run(
              pendingForm.task,
              pendingForm.mode,
              actionBody,
              () => {
                setPendingForm(null);
              },
              (error) => {
                setPendingForm((current) => (current ? { ...current, error } : current));
              }
            );
          }}
        />
      ) : null}
    </section>
  );
}
