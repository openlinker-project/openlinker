/**
 * Whether a fulfilment task has reached the pack bench (#3763)
 *
 * Replaces the "Handshake" field on the task card and the task detail page.
 * That field printed the negotiation axis (`requestStatus`) verbatim, and with
 * OpenLinker's own OMS as the only executor it read "Accepted" on almost every
 * task - a word that tells an operator nothing. The one state that matters is
 * the opposite one: the pack bench lists only ACCEPTED work, so a task that
 * never got accepted is one no packer can see. This derivation turns the axis
 * into that fact, and into nothing at all when there is no news.
 *
 * ## The input is a narrow struct, never the task
 *
 * The same rule `fulfillment-work-summary.ts` states (ADR-076): this module
 * branches on `requestStatus` for DISPLAY only, and taking scalars keeps the
 * task's `supportedActions` out of reach, so it cannot grow into a client-side
 * state machine.
 *
 * ## Only a task with an executor can be waiting for one
 *
 * An unassigned task was routed to nobody, so it was never offered and cannot
 * be "on its way" anywhere. The detail sentence already says it is not
 * assigned; reporting it as stuck acceptance would give it a second, wrong
 * reason.
 *
 * ## Why 15 minutes
 *
 * Dispatch runs on the realtime lane and normally accepts a routed task within
 * seconds, so a task still unaccepted after a quarter of an hour is not
 * "slow", it is stuck (a failed enqueue, a crashed claim). The server's own
 * timeout sweep only reaps after two hours - waiting for it would leave the
 * task invisible to packers for that long with nothing on screen. The state is
 * computed at render time, so an open page moves from pending to stuck on its
 * next re-render, not on the minute.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { formatCompactDuration } from './assign-packing-work-duration';
import { TASK_ACCEPTANCE_COPY } from './fulfillment-task.copy';

export const TASK_ACCEPTANCE_STUCK_AFTER_MS = 15 * 60_000;

export interface TaskAcceptanceInput {
  /** The negotiation axis. */
  requestStatus: string;
  /** When the task was created, i.e. routed. The clock a stuck task is measured on. */
  createdAt: string;
  /** Whether the task has an executor at all (`assignedConnectionId !== null`). */
  assigned: boolean;
}

export type TaskAcceptance =
  /** Accepted, unassigned, or a state this build does not recognise: nothing to say. */
  | { readonly kind: 'none' }
  /** Not accepted yet, but young enough to be in flight. */
  | { readonly kind: 'pending' }
  /** Not accepted, and old enough that it will not fix itself. */
  | { readonly kind: 'stuck'; readonly waitedMs: number }
  /** Reaped by the timeout sweep, or turned down by the executor. */
  | { readonly kind: 'refused' }
  /** A cancellation is being negotiated; carries the copy fragment. */
  | { readonly kind: 'cancellation'; readonly label: string };

const NOT_YET_ACCEPTED = new Set(['unsubmitted', 'submitted']);

/**
 * Pure: reads its argument and `now`, nothing else. An unparseable
 * `createdAt` reads as `pending`, never `stuck` - a warning the clock cannot
 * back is a false alarm.
 */
export function describeTaskAcceptance(input: TaskAcceptanceInput, now: Date): TaskAcceptance {
  const cancellation = TASK_ACCEPTANCE_COPY.cancellation[input.requestStatus];
  if (cancellation !== undefined) return { kind: 'cancellation', label: cancellation };

  if (!input.assigned) return { kind: 'none' };
  if (input.requestStatus === 'rejected') return { kind: 'refused' };
  if (!NOT_YET_ACCEPTED.has(input.requestStatus)) return { kind: 'none' };

  const createdMs = new Date(input.createdAt).getTime();
  if (Number.isNaN(createdMs)) return { kind: 'pending' };

  const waitedMs = now.getTime() - createdMs;
  return waitedMs >= TASK_ACCEPTANCE_STUCK_AFTER_MS
    ? { kind: 'stuck', waitedMs }
    : { kind: 'pending' };
}

/** Stuck and refused tasks are the ones packers cannot see: shown like a hold. */
export function needsAttention(acceptance: TaskAcceptance): boolean {
  return acceptance.kind === 'stuck' || acceptance.kind === 'refused';
}

/**
 * The status as one line: the card badge and the detail headline both read it.
 * Attention joins its reason to the status (card only: `withAttention`); a
 * cancellation joins its wording, except where the status already says it.
 */
export function taskStatusText(
  statusLabel: string,
  status: string,
  acceptance: TaskAcceptance,
  where: string,
  withAttention: boolean,
): string {
  if (withAttention && needsAttention(acceptance)) {
    return `${statusLabel} · ${TASK_ACCEPTANCE_COPY.badge(where)}`;
  }
  if (acceptance.kind === 'cancellation') {
    const repeatsStatus = status === 'cancelled' && acceptance.label === 'cancellation accepted';
    return repeatsStatus ? statusLabel : `${statusLabel} · ${acceptance.label}`;
  }
  return statusLabel;
}

/** The waited time as the warning prints it, e.g. "2h". */
export function formatAcceptanceWait(waitedMs: number): string {
  return formatCompactDuration(waitedMs);
}
