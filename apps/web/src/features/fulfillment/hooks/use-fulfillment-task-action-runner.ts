/**
 * The one place a fulfilment action becomes a request (#3257)
 *
 * Three surfaces invoke `POST /fulfillment/works/:workId/actions/:action`: the
 * fulfilment screen, the order-detail panel, and — since the screens merged —
 * the staffing board's own controls. The wiring that turns a click into that
 * request was duplicated word for word between the first two, and what was
 * being duplicated is the most consequential rule in the feature: the 409
 * contract. A third copy is how a rule documented at length in two files
 * quietly becomes two different rules.
 *
 * ## The three decisions this hook exists to hold exactly once
 *
 * 1. **`expectedVersion` is the version the caller RENDERED**, never one
 *    re-read at click time. Substituting a fresher token makes
 *    `version_conflict` unreachable and hands the win to the last writer,
 *    which is precisely the double-dispatch the token exists to refuse.
 * 2. **A conflict closes the form and returns early.** Keeping it open invites
 *    a resubmit carrying the same stale token. The surface has already
 *    refreshed itself (`useFulfillmentTaskActionMutation` invalidates on a
 *    conflict as well as on success), so the operator only has to look again.
 * 3. **A conflict is a `warning`, everything else an `error`.** A stale token
 *    is the guard working, not a fault. An illegal action is a fault.
 *
 * And one that is easy to lose in a refactor: a failure the DIALOG will render
 * as its own Alert is not also toasted — the operator is still in the form and
 * the remedy is usually in it. `closesTheForm` is what encodes that, and a
 * conflict is its one exception.
 *
 * ## `pendingForm` lives here too
 *
 * Not because it is complicated, but because its error field is scoped to the
 * form that earned it. One mutation object serves every task and every mode,
 * so a dismissed force-cancel failure on task A was still `isError` when the
 * hold dialog opened on task B — the dialog rendered "Could not put this
 * fulfilment task on hold" before anything had been submitted. Owning that
 * state next to the runner is what keeps the scoping from being re-derived
 * once per surface.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useState } from 'react';

import { useToast } from '../../../shared/ui/toast-provider';
import type {
  ApplyFulfillmentTaskActionRequest,
  FulfillmentTask,
  FulfillmentTaskHold,
} from '../api/fulfillment.types';
import {
  describeFulfillmentActionError,
  readFulfillmentConflict,
} from '../lib/fulfillment-conflict';
// The mode's own home. `fulfillment-task-action-dialog.tsx` re-exports it, but
// importing it from there would point a hook at a component that will import
// this hook back.
import {
  fulfillmentActionLabel,
  type FulfillmentTaskActionMode,
} from '../lib/fulfillment-task.copy';
import { useFulfillmentTaskActionMutation } from './use-fulfillment-task-action-mutation';

/** A dialog-backed action the operator has opened but not yet submitted. */
export interface FulfillmentPendingForm {
  mode: FulfillmentTaskActionMode;
  task: FulfillmentTask;
  hold?: FulfillmentTaskHold;
  /** THIS form's own submit failure, scoped so a dismissed one cannot reappear. */
  error?: unknown;
}

export interface UseFulfillmentTaskActionRunnerOptions {
  /**
   * Which order id rides along as context.
   *
   * Inert today — `useFulfillmentTaskActionMutation` destructures `orderId`
   * out and never sends it — but the two original call sites disagreed about
   * it (`task.orderId` on the list, the panel's own `internalOrderId`), so it
   * stays an explicit choice rather than being silently unified into whichever
   * one this hook happened to be written from.
   */
  readonly resolveOrderId?: (task: FulfillmentTask) => string;
}

export interface FulfillmentTaskActionRunner {
  /** The open dialog-backed form, or `null`. */
  readonly pendingForm: FulfillmentPendingForm | null;
  /** Which task has an action in flight — so only its own controls disable. */
  readonly busyTaskId: string | null;
  readonly openForm: (form: FulfillmentPendingForm) => void;
  readonly closeForm: () => void;
  /**
   * Submit the open form. Clears its previous failure first, so a corrected
   * note does not keep the old Alert on screen while the retry is in flight.
   *
   * A no-op with no form open, which makes the dialog's own `onSubmit` a
   * one-liner and removes the third copy of this block.
   */
  readonly submitForm: (body: Omit<ApplyFulfillmentTaskActionRequest, 'expectedVersion'>) => void;
  readonly run: (
    task: FulfillmentTask,
    action: string,
    body: Omit<ApplyFulfillmentTaskActionRequest, 'expectedVersion'>,
    onDone?: () => void,
    onFailure?: (error: unknown) => void
  ) => void;
}

export function useFulfillmentTaskActionRunner(
  options: UseFulfillmentTaskActionRunnerOptions = {}
): FulfillmentTaskActionRunner {
  const { resolveOrderId } = options;
  const mutation = useFulfillmentTaskActionMutation();
  const { showToast } = useToast();

  const [pendingForm, setPendingForm] = useState<FulfillmentPendingForm | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);

  const run: FulfillmentTaskActionRunner['run'] = (task, action, body, onDone, onFailure) => {
    setBusyTaskId(task.id);
    mutation.mutate(
      {
        workId: task.id,
        action,
        orderId: resolveOrderId?.(task) ?? task.orderId,
        // The token as RENDERED — see decision (1) in the module docblock.
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
          // A failure the dialog will render itself is not also toasted; a
          // conflict is the exception, because the form closes under it.
          const closesTheForm = conflict !== null || onFailure === undefined;
          if (closesTheForm) {
            showToast({
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

  return {
    pendingForm,
    busyTaskId,
    openForm: (form) => {
      setPendingForm(form);
    },
    closeForm: () => {
      setPendingForm(null);
    },
    submitForm: (body) => {
      if (pendingForm === null) return;
      setPendingForm((current) => (current === null ? null : { ...current, error: undefined }));
      run(
        pendingForm.task,
        pendingForm.mode,
        body,
        () => {
          setPendingForm(null);
        },
        (error) => {
          setPendingForm((current) => (current === null ? null : { ...current, error }));
        }
      );
    },
    run,
  };
}
