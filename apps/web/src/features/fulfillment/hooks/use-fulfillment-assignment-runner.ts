/**
 * The one place a staffing decision becomes a request (#3096)
 *
 * Lifted out of the assign board page so the task detail's Packer card and the
 * board send the SAME request, report its outcome through the SAME toast, and
 * read a failure the SAME way. A second copy of this block on the detail page
 * would be a second dialect of one optimistic-concurrency contract — the shape
 * `useFulfillmentTaskActionRunner` already exists to prevent for actions.
 *
 * ## Not the action runner, and not merged into it
 *
 * Assignment is not an action: ADR-074 puts WHO-may-assign outside the
 * legality matrix `applyAction` enforces, so a 409 here is only ever the
 * orthogonal lost-update guard, never `action_not_legal`. It has neither the
 * action runner's two-code 409 contract nor its dialog, so it keeps its own
 * busy flag rather than borrowing that one.
 *
 * ## The version sent is the one RENDERED
 *
 * `task.version` is the one the control was drawn with, never a fresher value
 * re-read at click time — see `UpdateFulfillmentWorkAssignmentRequest`'s own
 * docblock: a fresher token would make the 409 this guard exists to raise
 * unreachable and hand the last writer the win.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useCallback, useState } from 'react';

import { ApiError } from '../../../shared/api/api-error';
import { useToast } from '../../../shared/ui/toast-provider';
import type { FulfillmentTask } from '../api/fulfillment.types';
import { ASSIGN_PACKING_WORK_COPY } from '../lib/assign-packing-work.copy';
import { useUpdateFulfillmentAssignmentMutation } from './use-update-fulfillment-assignment-mutation';

/** What a staffing control may change. `undefined` means "leave alone". */
export interface FulfillmentAssignmentChange {
  assignedToUserId?: string | null;
  selfServeEligible?: boolean;
}

export interface FulfillmentAssignmentRunner {
  /** The task with an assignment write in flight, or `null`. */
  busyTaskId: string | null;
  setAssignment: (task: FulfillmentTask, change: FulfillmentAssignmentChange) => void;
}

/**
 * Which failure sentence a staffing write gets (#3415).
 *
 * Four unrelated failures used to share one, and its "Nothing has changed"
 * half is a claim rather than a hedge — true of a refusal, false of a 409,
 * and unknowable on a 5xx or a dropped connection, which is precisely when a
 * supervisor most needs to be told to go and look.
 *
 * A 401 is deliberately absent: the session layer already redirects, so a
 * toast about it would talk over a page that is on its way out.
 */
export function staffingFailureMessage(error: unknown, isMove: boolean): string {
  if (error instanceof ApiError) {
    if (error.isForbidden()) return ASSIGN_PACKING_WORK_COPY.row.moveForbidden;
    if (error.isNotFound()) return ASSIGN_PACKING_WORK_COPY.row.moveNotFound;
    if (error.isConflict()) return ASSIGN_PACKING_WORK_COPY.row.moveConflict;
    if (error.isServerError() || error.isNetworkError()) {
      return ASSIGN_PACKING_WORK_COPY.row.moveUnknown;
    }
    // A 4xx we do recognise as deterministic: the server refused, so nothing
    // changed and saying so is honest.
    return isMove
      ? ASSIGN_PACKING_WORK_COPY.row.moveFailed
      : ASSIGN_PACKING_WORK_COPY.row.selfServeFailed;
  }
  return ASSIGN_PACKING_WORK_COPY.row.moveUnknown;
}

export function useFulfillmentAssignmentRunner(): FulfillmentAssignmentRunner {
  const mutation = useUpdateFulfillmentAssignmentMutation();
  const { showToast } = useToast();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const { mutate } = mutation;

  const setAssignment = useCallback(
    (task: FulfillmentTask, change: FulfillmentAssignmentChange): void => {
      setBusyTaskId(task.id);
      // #3429 — the two success messages are told apart by which field the
      // CALLER set, never guessed from the task's new state: a self-serve
      // toggle on an already-unassigned task could otherwise read as a move.
      const isMove = 'assignedToUserId' in change;
      const successMessage = isMove
        ? ASSIGN_PACKING_WORK_COPY.row.moveSucceeded
        : ASSIGN_PACKING_WORK_COPY.row.selfServeUpdated;

      mutate(
        { workId: task.id, expectedVersion: task.version, ...change },
        {
          onSuccess: () => {
            showToast({ tone: 'success', description: successMessage });
          },
          onError: (error) => {
            showToast({ tone: 'error', description: staffingFailureMessage(error, isMove) });
          },
          onSettled: () => {
            setBusyTaskId(null);
          },
        }
      );
    },
    [mutate, showToast]
  );

  return { busyTaskId, setAssignment };
}
