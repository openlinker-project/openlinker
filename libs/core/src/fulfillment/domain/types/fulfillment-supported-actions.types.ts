/**
 * Supported-action derivation (#2406, `W3a-19`, DESIGN §5.2, REVIEW C10)
 *
 * *"The read model returns `supportedActions` with the resource — the server
 * tells the client what is legal next, which kills client-side state-machine
 * drift across heterogeneous executors."*
 *
 * This is the rule that answers **"what is legal now"** over the two orthogonal
 * axes (`FulfillmentWorkStatus` × `FulfillmentRequestStatus`) plus the work's
 * active-hold count. It is pure — no I/O, no injected dependency, no framework
 * import, no mutation — and it reads only scalars, which is what keeps ADR-053's
 * no-injection invariant intact here.
 *
 * ## Why this is a NEW file rather than an edit to `fulfillment-work-action.types.ts`
 *
 * That file is #2391's vocabulary leaf, and it says of `supportedActions`: *"a
 * field here would invite a client to recompute legality locally, which is
 * precisely the client-side state-machine drift 'actions yes, states no' exists
 * to kill."* The VOCABULARY and its LEGALITY RULE are separately owned — and
 * keeping them apart also keeps this change off a live sibling-conflict surface.
 * It qualifies for `engineering-standards.md`'s pure-rule exception on all three
 * counts: pure; it *is* the rule for the vocabulary it derives over; and both
 * halves change together (a new action member without a rule here is a member
 * that can never be offered).
 *
 * ## Two states are not PRODUCED by any action, and this file must not imply they are
 *
 * `on_hold` is entered by writing a `fulfillment_holds` row and `incomplete`
 * only by a `short_picked` progress event (#2400). Neither is an action's
 * target. So heldness suppresses forward motion here; there is no action whose
 * effect is "become on_hold" beyond `hold` writing its row.
 *
 * ## `activeHoldCount` is the authority on heldness, NOT `status`
 *
 * Nothing in the tree writes `status = 'on_hold'`: `placeHold` inserts the hold
 * row and does not touch `status`, and that column's named writers are `create`
 * / `transitionStatus` / `cancel` only. A held work therefore reads
 * `status: 'open'` with a non-empty `activeHolds[]`. Keying on the count rather
 * than the status is what makes this derivation correct against the data that
 * actually exists.
 *
 * `'on_hold'` is nonetheless admitted to the `schedule` / `mark_in_progress`
 * antecedents when nothing is held, so a work that somehow reaches that status
 * with every hold released is not permanently stranded — its only remaining
 * exits would otherwise be `hold` and `force_cancel`.
 *
 * ## The four holder replies are absent by construction
 *
 * `accept`, `reject`, `accept_cancellation` and `reject_cancellation` are the
 * HOLDER's answers, recorded by #2399's `recordAcceptance` / `recordRejection`
 * off an executor response. They are never an operator's act, so offering them
 * on an operator read model would be the drift this exists to remove, pointing
 * the other way.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.2
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import { FULFILLMENT_HOLD_ACTIVE_LIMIT } from './fulfillment-hold.types';
import type { FulfillmentRequestStatus } from './fulfillment-request-status.types';
import type { FulfillmentWorkAction } from './fulfillment-work-action.types';
import type { FulfillmentWorkStatus } from './fulfillment-work-status.types';

/**
 * Execution states from which no further work is possible.
 *
 * `on_hold` is deliberately NOT here — a hold is suspension, not an ending.
 */
export const TERMINAL_FULFILLMENT_WORK_STATUSES = [
  'closed',
  'cancelled',
  'incomplete',
] as const satisfies readonly FulfillmentWorkStatus[];

/** True when the execution axis has come to rest and cannot move again. */
export function isTerminalFulfillmentWorkStatus(status: FulfillmentWorkStatus): boolean {
  return (TERMINAL_FULFILLMENT_WORK_STATUSES as readonly FulfillmentWorkStatus[]).includes(status);
}

/**
 * The scalars the derivation reads.
 *
 * Deliberately NOT the `FulfillmentWork` aggregate: passing the aggregate would
 * let a future rule reach for a line counter, and the optimistic token
 * guards header transitions only (see the worklist service). A narrow input is
 * what makes that boundary checkable.
 */
export interface SupportedActionsInput {
  readonly status: FulfillmentWorkStatus;
  readonly requestStatus: FulfillmentRequestStatus;
  readonly activeHoldCount: number;
  readonly assignedConnectionId: string | null;
}

/**
 * Everything legal on this work right now, in a stable order.
 *
 * The order is the declaration order below rather than the vocabulary's, so the
 * answer is deterministic for a client diffing two reads.
 */
export function deriveSupportedActions(
  input: SupportedActionsInput
): readonly FulfillmentWorkAction[] {
  const { status, requestStatus, activeHoldCount, assignedConnectionId } = input;

  const terminal = isTerminalFulfillmentWorkStatus(status);
  const held = activeHoldCount > 0;
  const actions: FulfillmentWorkAction[] = [];

  if (!terminal && !held && (status === 'open' || status === 'on_hold')) {
    actions.push('schedule');
  }

  // Offering the work to a holder. `rejected` is included because a rejection
  // is not an ending — ADR-054 re-sources rejected work, excluding blocking
  // rejecters, which is a router concern rather than a legality one here.
  if (
    !terminal &&
    !held &&
    assignedConnectionId !== null &&
    (requestStatus === 'unsubmitted' || requestStatus === 'rejected')
  ) {
    actions.push('submit');
  }

  // The negotiation, not the command: cancelling ACCEPTED work has to be asked
  // for. This is the member that makes "cancel is a command" wrong.
  if (!terminal && requestStatus === 'accepted') {
    actions.push('request_cancellation');
  }

  // Not suppressed by `held`: a second hold for a second reason is legitimate,
  // up to the limit. The limit is re-checked at write time, so a racing tenth
  // hold can still be refused — see the service.
  if (!terminal && activeHoldCount < FULFILLMENT_HOLD_ACTIVE_LIMIT) {
    actions.push('hold');
  }

  if (held) {
    actions.push('release_hold');
  }

  if (!terminal && !held && (status === 'open' || status === 'scheduled' || status === 'on_hold')) {
    actions.push('mark_in_progress');
  }

  // Completion, never a force-close. Observation-only work on an
  // `omp_fulfilled` topology "may never leave `open`", so OL never closes it —
  // its only terminal is `force_cancel`, which ADR-054 keeps deliberately
  // distinct from completion. That is intended, not a missing rule.
  if (status === 'in_progress') {
    actions.push('close');
  }

  // Unilateral, and the stated exit when a disabled holder connection cannot be
  // resolved for negotiation at all.
  if (!terminal) {
    actions.push('force_cancel');
  }

  return actions;
}
