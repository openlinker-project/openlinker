/**
 * Fulfilment-task operator copy (#2411)
 *
 * Labels for the server-owned vocabularies this panel renders.
 *
 * ## Deliberately LOOSE records, not `satisfies Record<Union, …>`
 *
 * Everywhere else in this app a copy table is pinned to its union with
 * `satisfies`, so adding a value without copy is a compile error. That shape is
 * wrong here and would actively harm, for two reasons:
 *
 *   1. There is no union to pin to. `apps/web` may not declare one — see the
 *      `fulfillment.types.ts` docblock and
 *      `scripts/check-no-supported-actions-mirror.mjs`.
 *   2. Pinning would mean the day the backend adds a seventh action, this build
 *      stops compiling — and before it stopped compiling, on a deployed bundle,
 *      it would render nothing for that action. A value the server declared
 *      legal must stay INVOKABLE; falling back to its raw name shows the
 *      operator something they can act on and can quote in a ticket.
 *
 * The accepted cost: a typo in a key here is a silently unlabelled control
 * rather than a compile error. That is the fail-safe direction — no branch
 * anywhere reads these values, so a miss costs a label and never a decision.
 *
 * Operator-facing wording follows the epic-#2412 UI naming rule: **fulfilment
 * task**, never the internal aggregate name (`scripts/check-ui-vocabulary.mjs`
 * enforces it for this folder).
 *
 * @module apps/web/src/features/fulfillment/lib
 */

export interface FulfillmentActionCopy {
  /** Button label. */
  label: string;
  /** Button tone — `danger` for the irreversible ones. */
  tone: 'primary' | 'secondary' | 'danger';
  /** One sentence rendered as the control's `title`. */
  hint: string;
}

/**
 * Copy per operator-invocable action.
 *
 * The keys are the six members of the server's `OPERATOR_INVOCABLE_ACTIONS` as
 * of #2406. This is a lookup table, not a declaration of what is legal — the
 * server's `supportedActions` decides that, and this map is consulted only for
 * entries that array already contains.
 */
export const FULFILLMENT_ACTION_COPY: Record<string, FulfillmentActionCopy> = {
  schedule: {
    label: 'Schedule',
    tone: 'secondary',
    hint: 'Plan this task for execution. It is not started yet.',
  },
  hold: {
    label: 'Put on hold',
    tone: 'secondary',
    hint: 'Suspend this task until someone releases the hold.',
  },
  release_hold: {
    label: 'Release hold',
    tone: 'primary',
    hint: 'Lift this hold so the task can move again.',
  },
  mark_in_progress: {
    label: 'Mark in progress',
    tone: 'primary',
    hint: 'Someone has started working this task.',
  },
  close: {
    label: 'Close',
    tone: 'primary',
    hint: 'This task is finished.',
  },
  force_cancel: {
    label: 'Force cancel',
    tone: 'danger',
    hint: 'Cancel this task outright, without asking whoever holds it.',
  },
};

/** Title-case a raw vocabulary value so an unrecognised one is still readable. */
function humanise(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, ' ').trim();
  if (spaced.length === 0) return raw;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Label for an action, or a humanised form of the raw name when this build does
 * not recognise it. Never returns empty — an unlabelled button is worse than a
 * roughly-labelled one.
 */
export function fulfillmentActionLabel(action: string): string {
  return FULFILLMENT_ACTION_COPY[action]?.label ?? humanise(action);
}

/** Tone for an action; an unrecognised action gets the neutral one. */
export function fulfillmentActionTone(action: string): 'primary' | 'secondary' | 'danger' {
  return FULFILLMENT_ACTION_COPY[action]?.tone ?? 'secondary';
}

/**
 * Hint for an action. `null` — not a fabricated sentence — when unrecognised:
 * a tooltip is a claim about what a button does, and this build does not know.
 */
export function fulfillmentActionHint(action: string): string | null {
  return FULFILLMENT_ACTION_COPY[action]?.hint ?? null;
}

/** Which actions need a form before they can be sent. */
export const FULFILLMENT_ACTIONS_NEEDING_A_FORM = new Set(['hold', 'release_hold', 'force_cancel']);

/** Orchestration-status labels. Display only — nothing branches on these. */
const STATUS_COPY: Record<string, string> = {
  open: 'Open',
  scheduled: 'Scheduled',
  on_hold: 'On hold',
  in_progress: 'In progress',
  closed: 'Closed',
  cancelled: 'Cancelled',
  incomplete: 'Incomplete',
};

export function fulfillmentStatusLabel(status: string): string {
  return STATUS_COPY[status] ?? humanise(status);
}

/** Handshake-status labels. Display only. */
const REQUEST_STATUS_COPY: Record<string, string> = {
  unsubmitted: 'Not offered yet',
  submitted: 'Offered, awaiting reply',
  accepted: 'Accepted',
  rejected: 'Refused',
  cancellation_requested: 'Cancellation requested',
  cancellation_accepted: 'Cancellation accepted',
  cancellation_rejected: 'Cancellation refused',
};

export function fulfillmentRequestStatusLabel(requestStatus: string): string {
  return REQUEST_STATUS_COPY[requestStatus] ?? humanise(requestStatus);
}
