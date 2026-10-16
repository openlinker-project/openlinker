/**
 * Whether a fulfilment task has reached the pack bench (#3763)
 *
 * Replaces the "Handshake" field on the task card and the task detail page.
 * That field printed the negotiation axis (`requestStatus`) verbatim, and with
 * OpenLinker's own OMS as the only executor it read "Accepted" on almost every
 * task - a word that tells an operator nothing. The one state that matters is
 * the opposite one: the pack bench lists only ACCEPTED work, so a task that
 * never got accepted is a parcel no packer can see. This derivation turns the
 * axis into that fact, and into nothing at all when there is no news.
 *
 * ## The input is a narrow struct, never the task
 *
 * The same rule `fulfillment-work-summary.ts` states (ADR-076): this module
 * branches on `requestStatus` for DISPLAY only, and taking two scalars keeps
 * the task's `supportedActions` out of reach, so it cannot grow into a
 * client-side state machine.
 *
 * ## Why 15 minutes
 *
 * Dispatch runs on the realtime lane and normally accepts a routed task within
 * seconds, so a task still unaccepted after a quarter of an hour is not
 * "slow", it is stuck (a failed enqueue, no holder, a crashed claim). The
 * server's own timeout sweep only reaps after two hours - waiting for it would
 * leave the parcel invisible to packers for that long with nothing on screen.
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
}

export type TaskAcceptance =
  /** Accepted, or a state this build does not recognise: nothing to say. */
  | { readonly kind: 'none' }
  /** Not accepted yet, but young enough to be in flight. */
  | { readonly kind: 'pending' }
  /** Not accepted, and old enough that it will not fix itself soon. */
  | { readonly kind: 'stuck'; readonly waitedMs: number }
  /** Reaped by the timeout sweep (or refused by an executor). */
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
  if (input.requestStatus === 'rejected') return { kind: 'refused' };

  const cancellation = TASK_ACCEPTANCE_COPY.cancellation[input.requestStatus];
  if (cancellation !== undefined) return { kind: 'cancellation', label: cancellation };

  if (!NOT_YET_ACCEPTED.has(input.requestStatus)) return { kind: 'none' };

  const createdMs = new Date(input.createdAt).getTime();
  if (Number.isNaN(createdMs)) return { kind: 'pending' };

  const waitedMs = now.getTime() - createdMs;
  return waitedMs >= TASK_ACCEPTANCE_STUCK_AFTER_MS
    ? { kind: 'stuck', waitedMs }
    : { kind: 'pending' };
}

/**
 * The state line both surfaces render: the orchestration label, plus a short
 * qualifier only when acceptance is news. A stuck or refused task also gets a
 * warning (`FulfillmentTaskAcceptanceNotice`), so the qualifier stays short.
 */
export function taskStateLine(
  statusLabel: string,
  acceptance: TaskAcceptance,
  where: string,
): string {
  switch (acceptance.kind) {
    case 'pending':
    case 'stuck':
      return `${statusLabel} · ${TASK_ACCEPTANCE_COPY.pending(where)}`;
    case 'cancellation':
      return `${statusLabel} · ${acceptance.label}`;
    case 'refused':
    case 'none':
      return statusLabel;
  }
}

/** The waited time as the notice prints it, e.g. "2h". */
export function formatAcceptanceWait(waitedMs: number): string {
  return formatCompactDuration(waitedMs);
}
