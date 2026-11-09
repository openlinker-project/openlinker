/**
 * Fulfilment-task labels (#2411, i18n #3875)
 *
 * Labels for the server-owned vocabularies this feature renders, read from the
 * `fulfillment` namespace at call time so they follow the active language.
 *
 * ## Deliberately LOOSE lookups, not `satisfies Record<Union, …>`
 *
 * There is no union to pin to: `apps/web` may not declare one (see the
 * `fulfillment.types.ts` docblock and
 * `scripts/check-no-supported-actions-mirror.mjs`). A value the server declared
 * legal must stay INVOKABLE, so an action or status this build has no copy for
 * falls back to a humanised form of its raw name. A miss costs a label and
 * never a decision.
 *
 * @module apps/web/src/features/fulfillment/lib
 */
import { getMessages, interpolate } from '../../../shared/i18n';

type ActionTone = 'primary' | 'secondary' | 'danger';

/**
 * Button tone per action — `danger` for the irreversible one. Neither expedite
 * verb is `danger`: both are reversible, and colouring a reversible act as
 * destructive spends the signal that marks the one act that is not.
 */
const ACTION_TONE: Readonly<Record<string, ActionTone>> = {
  schedule: 'secondary',
  hold: 'secondary',
  release_hold: 'primary',
  mark_in_progress: 'primary',
  close: 'primary',
  force_cancel: 'danger',
  expedite: 'secondary',
  release_expedite: 'secondary',
};

interface ActionCopy {
  readonly label: string;
  readonly hint: string;
}

function actionCopy(action: string): ActionCopy | undefined {
  const table = getMessages('fulfillment').action as Readonly<Record<string, ActionCopy>>;
  return Object.prototype.hasOwnProperty.call(table, action) ? table[action] : undefined;
}

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
  return actionCopy(action)?.label ?? humanise(action);
}

/** Tone for an action; an unrecognised action gets the neutral one. */
export function fulfillmentActionTone(action: string): ActionTone {
  return ACTION_TONE[action] ?? 'secondary';
}

/**
 * Hint for an action. `null` — not a fabricated sentence — when unrecognised:
 * a tooltip is a claim about what a button does, and this build does not know.
 */
export function fulfillmentActionHint(action: string): string | null {
  return actionCopy(action)?.hint ?? null;
}

/** Which actions need a form before they can be sent. */
export const FULFILLMENT_ACTIONS_NEEDING_A_FORM = new Set(['hold', 'release_hold', 'force_cancel']);

/** The success toast for an applied action (#3257). */
export function fulfillmentActionAppliedToast(action: string): string {
  return interpolate(getMessages('fulfillment').actionAppliedToast, {
    action: fulfillmentActionLabel(action),
  });
}

/** The fallback failure sentence; the label is lower-cased to read inside the sentence. */
export function fulfillmentActionFailedFallback(action: string): string {
  return interpolate(getMessages('fulfillment').actionFailedFallback, {
    action: fulfillmentActionLabel(action).toLowerCase(),
  });
}

/** Orchestration-status label. Display only — nothing branches on these. */
export function fulfillmentStatusLabel(status: string): string {
  const table = getMessages('fulfillment').status as Readonly<Record<string, string>>;
  return Object.prototype.hasOwnProperty.call(table, status) ? (table[status] ?? humanise(status)) : humanise(status);
}

/**
 * The three actions that need a form before they can be sent. Their dialog
 * copy lives under `fulfillment.actionMode`.
 */
export type FulfillmentTaskActionMode = 'hold' | 'release_hold' | 'force_cancel';
