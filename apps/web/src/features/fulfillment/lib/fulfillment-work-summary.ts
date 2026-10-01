/**
 * Plain-language summary for one fulfilment task (#3099)
 *
 * The sentence rendered beneath the hero's two raw axis labels. The headline
 * stays those labels joined (`In progress · Accepted`); this derives the line
 * under it, because neither axis alone answers what an operator is asking.
 *
 * ## The input is a narrow struct, never the task, and that is the point
 *
 * `fulfillment.types.ts` states that nothing in this app branches on `status`
 * or `requestStatus`, and `scripts/check-no-supported-actions-mirror.mjs`
 * backs it. This derivation does branch on them, so it is a NARROWING of that
 * rule (recorded by ADR-076, #3248) rather than an exception to it: what
 * stays untouched is that controls come from the server's own action list
 * and from nothing else.
 *
 * A function handed the whole task could reach that list, and branching on it
 * is precisely the client-side state machine the guard cannot catch — its own
 * docblock says as much, since one `if` inside a caller is the real drift
 * shape and no static matcher detects it. Taking six scalars instead makes the
 * drift UNREACHABLE from here rather than merely discouraged. Widening this
 * struct to accept the task would quietly undo that, so it does not happen.
 *
 * ## Precedence, and why it is not arbitrary
 *
 * First match wins:
 *
 * ```
 * cancelled > incomplete > held > cancellation_requested > cancellation_rejected
 *           > submitted > unassigned > scheduled / in_progress (expedited or not)
 * ```
 *
 * Heldness and the negotiation axis both outrank the bare orchestration
 * status, because `status` alone can say neither "on hold" (nothing ever
 * writes `on_hold`, so a held task reads `open`) nor "a cancellation is in
 * flight".
 *
 * ## An unrecognised combination renders NO sentence
 *
 * Not a guessed one, and not a fallback that hedges. A sentence is a claim
 * about what is happening to somebody's parcel, and this build may not know —
 * the same fail-safe direction `fulfillmentActionHint` already takes by
 * returning `null` rather than a fabricated tooltip. The hero's two axis
 * labels still render, so the page is never blank.
 *
 * Three reachable states produce no sentence, all confirmed rather than
 * papered over: `open` + `unsubmitted` with a location and no holds (the
 * commonest state a freshly routed task is in), `open` + `accepted` (a task
 * whose holder accepted and has not started picking), and
 * `requestStatus: 'rejected'`.
 *
 * ## It returns a string, never a tone
 *
 * Colour marks attention, and on this page that is the hold banners and
 * nothing else. A page where every state is coloured has no way left to say
 * "this one needs you".
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { FULFILLMENT_WORK_DETAIL_COPY } from './fulfillment-work-detail.copy';

const SUMMARY = FULFILLMENT_WORK_DETAIL_COPY.summary;

/**
 * Everything the sentence is derived from, and deliberately nothing more.
 *
 * `executorName` is resolved by the CALLER — the connection display name is a
 * lookup this module has no business performing, and passing the resolved
 * value keeps the derivation pure.
 */
export interface FulfillmentWorkSummaryInput {
  /** Orchestration axis. Not the authority on heldness — see `activeHoldCount`. */
  status: string;
  /** Negotiation axis. */
  requestStatus: string;
  /** THE authority on heldness. */
  activeHoldCount: number;
  /** `null` when the task has not been routed anywhere yet. */
  locationId: string | null;
  /** `null` means NOT expedited, never "unknown". */
  expeditedAt: string | null;
  /** Why a cancelled task was cancelled. The discriminator the axes lack. */
  cancellationReason: string | null;
  /** Resolved display name of the executing connection, or `null`. */
  executorName: string | null;
}

/**
 * The cancelled branch, which departs from the design of record on purpose.
 *
 * A force-cancel and a holder giving the task back can produce the identical
 * `status`/`requestStatus` pair, but they are different sentences to an
 * operator: two axes cannot separate them. `cancellationReason` carries the
 * discriminator.
 *
 * `rerouted` and `order_cancelled` get NO sentence: the executing connection
 * did nothing wrong in either, and "gave this back" would be a false
 * accusation. `null` and any value this build does not recognise fall the
 * same way, for the same reason.
 */
function summariseCancelled(reason: string | null, subject: string): string | null {
  switch (reason) {
    case 'operator_forced':
      return SUMMARY.cancelledByOperator(subject);
    case 'holder_rejected':
    case 'holder_unreachable':
      return SUMMARY.cancelledGivenBack(subject);
    default:
      return null;
  }
}

/**
 * One sentence describing what is happening to this task, or `null` when this
 * build cannot say. Pure — it reads its argument and the copy table, nothing
 * else, and mutates neither.
 */
export function summariseFulfillmentWork(input: FulfillmentWorkSummaryInput): string | null {
  const subject = input.executorName ?? SUMMARY.executorFallback;

  if (input.status === 'cancelled') return summariseCancelled(input.cancellationReason, subject);
  if (input.status === 'incomplete') return SUMMARY.incomplete(subject);
  if (input.activeHoldCount > 0) return SUMMARY.onHold(input.activeHoldCount);
  if (input.requestStatus === 'cancellation_requested')
    return SUMMARY.cancellationRequested(subject);
  if (input.requestStatus === 'cancellation_rejected') return SUMMARY.cancellationRejected(subject);
  if (input.requestStatus === 'submitted') return SUMMARY.awaitingAnswer(subject);
  // Only where "nothing to pick yet" is actually true. A task can reach
  // `in_progress` or `closed` while `locationId` stays null — nothing in the
  // server's action derivation reads the location, and on the default
  // `omp_fulfilled` topology an observation-only work object may never
  // acquire one — so an unguarded check here says "not yet assigned
  // anywhere, so there is nothing to pick" about a task somebody already
  // finished.
  if (input.locationId === null && (input.status === 'open' || input.status === 'scheduled'))
    return SUMMARY.unassigned;
  if (input.status === 'scheduled') return SUMMARY.scheduled(subject);
  if (input.status === 'in_progress') {
    return input.expeditedAt !== null
      ? SUMMARY.inProgressExpedited(subject)
      : SUMMARY.inProgress(subject);
  }
  if (input.status === 'closed') return SUMMARY.closed;

  return null;
}
