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
 * task**, never the internal aggregate name.
 *
 * ## The `.copy.ts` in the filename is load-bearing, not decoration
 *
 * `scripts/check-ui-vocabulary.mjs` scans a `.tsx` for JSX text and a
 * whitelist of user-facing attributes, and a `*.copy.ts` for EVERY string
 * literal. Nothing else. Named `fulfillment-task-copy.ts` — one character out —
 * this file was invisible to the gate, so every label, hint and status word
 * below could have carried a banned term with the build green. That is why the
 * dialog's own sentences live here too rather than as a record inside the
 * `.tsx`: an object literal in a component is not JSX text and is not scanned
 * either. Operator sentences belong in this file, and this file must keep this
 * name.
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
 * The keys are the eight members of the server's `OPERATOR_INVOCABLE_ACTIONS`
 * as of #2416 (six from #2406, plus the expedite pair). This is a lookup table, not a declaration of what is legal — the
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
  // #2416. `exposedActions` is shared, so these reach this worklist as well as
  // the pack bench — which is right: a supervisor pushing a parcel forward does
  // it from here. Labelled rather than left to the humanising fallback, which
  // would render a bare "Expedite" with no hint on a control that reorders
  // somebody else's queue.
  //
  // Exactly one of the two is ever offered for a given task, because the server
  // picks the direction. Neither is `danger`: both are reversible, and colouring
  // a reversible act as destructive spends the signal that marks the one act on
  // this surface that is not.
  expedite: {
    label: 'Move to the front',
    tone: 'secondary',
    hint: 'Pack this ahead of its deadline order. It stays marked as moved, and it can be moved back.',
  },
  release_expedite: {
    label: 'Back to deadline order',
    tone: 'secondary',
    hint: 'Stop moving this ahead of the queue. It returns to its place by dispatch deadline.',
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

/**
 * The three actions that need a form before they can be sent.
 *
 * Here rather than in `fulfillment-task-action-dialog.tsx` for the reason in
 * the module docblock: these are the longest operator sentences this feature
 * ships, and a `Record` inside a component escapes the vocabulary gate.
 */
export type FulfillmentTaskActionMode = 'hold' | 'release_hold' | 'force_cancel';

export interface FulfillmentTaskActionModeCopy {
  title: string;
  description: string;
  /** Submit-button label. */
  confirm: string;
  /** Fallback sentence when the server gave no better one. */
  failure: string;
}

export const FULFILLMENT_ACTION_MODE_COPY: Record<
  FulfillmentTaskActionMode,
  FulfillmentTaskActionModeCopy
> = {
  hold: {
    title: 'Put this fulfilment task on hold',
    description:
      'The task stops moving until someone releases the hold. The rest of the order is unaffected.',
    confirm: 'Put on hold',
    failure: 'Could not put this fulfilment task on hold.',
  },
  release_hold: {
    title: 'Release this hold',
    description: 'The fulfilment task can move again. Any other hold on it stays in place.',
    confirm: 'Release hold',
    failure: 'Could not release this hold.',
  },
  force_cancel: {
    title: 'Force-cancel this fulfilment task',
    description:
      'This cancels the task outright without asking whoever holds it, and cannot be undone. The order itself is not cancelled.',
    confirm: 'Force cancel',
    failure: 'Could not cancel this fulfilment task.',
  },
};
