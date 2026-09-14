/**
 * Sourcing-rule operator copy (#3057)
 *
 * Every sentence the table renders about a rule's vocabulary, in one place.
 *
 * ## Lookups are LOOSE, and that is deliberate
 *
 * The API stores `kind` / `name` / `afterAction` verbatim and reports
 * `recognised: false` for a row this build cannot evaluate. Every accessor here
 * therefore falls back to the RAW value rather than to a generic sentence: an
 * unrecognised rule must degrade to *shown but unlabelled*, never to *silently
 * dropped* or to a confident label for something we do not understand. The
 * `fulfillment-task.copy.ts` precedent.
 *
 * @module apps/web/src/features/oms/lib
 */
import type { SourcingAfterAction } from './sourcing-rule-vocabulary';

/** Short label for a rule name, shown beside its kind badge. */
const NAME_LABEL: Readonly<Record<string, string>> = {
  'in-stock': 'In stock',
  'country-served': 'Country served',
  'not-blocked-by-reject': 'Not blocked',
  priority: 'Priority list',
  nearest: 'Nearest',
  'most-complete': 'Most complete',
  'least-splits': 'Fewest splits',
};

/** One sentence saying what the rule actually does, under the label. */
const NAME_HINT: Readonly<Record<string, string>> = {
  'in-stock': 'Rules out any location with no stock of at least one item in this order.',
  'country-served':
    "Only keeps a location if it's registered in the same country the order ships to — " +
    'that is about where the location physically is, not which countries it is set up to ship to.',
  'not-blocked-by-reject': 'Rules out a location that already turned this order down.',
  priority: 'Ranks locations in the order you choose.',
  nearest:
    'Ranks by how close the postcode is to the delivery address — not the real driving or ' +
    'shipping distance. With PII storage off there is no postcode to compare, so it falls ' +
    'back to ranking by country alone.',
  'most-complete': 'Prefers the location that can fulfil the most items in this order.',
  'least-splits':
    'Prefers a single location that can fulfil the whole order, to avoid splitting it.',
};

const KIND_HINT: Readonly<Record<string, string>> = {
  filter: 'Filter — rules out locations that cannot do the job.',
  sort: 'Sort — ranks whichever locations are left.',
};

const AFTER_ACTION_LABEL: Readonly<Record<SourcingAfterAction, string>> = {
  'no-split': 'No split',
  'line-split': 'Line split',
  'quantity-split': 'Quantity split',
};

const AFTER_ACTION_HINT: Readonly<Record<SourcingAfterAction, string>> = {
  'no-split': 'The whole order ships from a single location — or not at all.',
  'line-split':
    'Different items can ship from different locations. Each item still ships whole, from one place.',
  'quantity-split':
    "Even a single item's quantity can be split — e.g. 2 units from one location, 3 from another.",
};

/** Human label for a rule name, or the raw value when this build has none. */
export function sourcingRuleNameLabel(name: string): string {
  return NAME_LABEL[name] ?? name;
}

/** One-sentence explanation, or `null` when this build has none to give. */
export function sourcingRuleNameHint(name: string): string | null {
  return NAME_HINT[name] ?? null;
}

export function sourcingRuleKindHint(kind: string): string | null {
  return KIND_HINT[kind] ?? null;
}

export function sourcingAfterActionLabel(afterAction: string): string {
  return AFTER_ACTION_LABEL[afterAction as SourcingAfterAction] ?? afterAction;
}

export function sourcingAfterActionHint(afterAction: string): string | null {
  return AFTER_ACTION_HINT[afterAction as SourcingAfterAction] ?? null;
}

export const SOURCING_RULES_TABLE_COPY = {
  caption: 'Sourcing rules, in the order they run',
  stepHeader: 'Step',
  stepHint: 'Rules run in this order. Use the arrows to reorder.',
  ruleHeader: 'Rule',
  splittingHeader: 'Splitting',
  splittingHint: 'How far this rule lets an order be divided across locations.',
  windowHeader: 'Active window',
  statusHeader: 'Status',
  actionsHeader: 'Actions',
  alwaysActive: 'Always',
  moveUp: 'Move up',
  moveDown: 'Move down',
  moveToTop: 'Move to top',
  moveToBottom: 'Move to bottom',
  governs: "Sets today's splitting limit",
  /**
   * Names the CONTROL, not the outcome.
   *
   * The button is enabled and opens the explanation, so its accessible name has
   * to say what clicking does. Announcing the refusal here instead would offer
   * a live action under a name that says it cannot act, and a sighted operator
   * would read “cannot edit” and never reach the one remedy there is.
   */
  editRefusedAction: 'Why this rule cannot be edited',
  /**
   * The fallback name, used only where no explanation is wired and the control
   * is therefore genuinely inert.
   */
  editLocked: 'Cannot edit — this rule is no longer recognised',
} as const;

/**
 * The three read states (#3061).
 *
 * `empty` says what the ABSENCE means rather than merely that the list is
 * empty: with no rule, the router narrows nothing, which is the fact an
 * operator needs in order to decide whether to act.
 *
 * `error` says explicitly that nothing changed. A failed READ is the one
 * failure an operator is most likely to mistake for a lost configuration.
 */
export const SOURCING_RULES_STATE_COPY = {
  loadingTitle: 'Loading sourcing rules',
  loadingMessage: 'Reading the rules that decide where an order ships from…',
  errorTitle: 'Could not load sourcing rules',
  errorMessage:
    'Your sourcing rules could not be read just now. Nothing has changed — this is a loading problem, not a configuration one.',
  errorRetry: 'Retry',
  emptyEyebrow: 'No rules',
  emptyTitle: 'Nothing decides where an order ships from yet',
  emptyMessage:
    'Without a rule, no location is ruled out and none is ranked. Add a rule to start narrowing down which locations qualify.',
  addRule: 'Add rule',
  /**
   * The reorder refusal is dismissed BY HAND, never on the next settle.
   *
   * A 409 invalidates the list, so an auto-clear tied to the refreshed read
   * would pull the sentence away within a few hundred milliseconds of it
   * appearing — the operator would see a row snap back with no surviving
   * explanation, which is the state the message exists to prevent.
   */
  dismissReorderError: 'Dismiss',
} as const;
