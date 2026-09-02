/**
 * Automation Legality Matrix (#2359, Wave-2 spec §5.4)
 *
 * Which action may follow which trigger, as **one declared table** with three
 * consumers: the write path (`AutomationRulesService`), the composer's option
 * list (#2365, via the #2363 vocabulary endpoint) and the evaluator's own guard
 * (`evaluateAutomationRules`). One source, three consumers — so an illegal pair
 * cannot be persisted by curl either, and the composer cannot offer a pair the
 * evaluator would refuse.
 *
 * **Why a table at all.** Not every trigger→action pair is meaningful, and
 * offering a meaningless one is how an operator builds a rule that silently
 * never fires: *"when a return is received, buy a shipping label"* saves,
 * arms, and then does nothing forever, with no error anywhere. The composer
 * offering only legal pairs is the fix; the write-path and evaluator guards are
 * what make that offer a rule rather than a convention.
 *
 * **The `satisfies` on both maps is load-bearing.** A ninth trigger or a
 * seventh action added without a row/column is a compile error, not a pair that
 * silently reads as illegal (which would be a rule that saves and never fires —
 * the exact defect this file exists to prevent, one level up).
 *
 * ## Two tables, because they answer different questions
 *
 * `AUTOMATION_LEGAL_ACTIONS` is the §5.4 matrix proper (48 cells) and is
 * ENFORCED on the write path and in the evaluator. `AUTOMATION_LEGAL_CONDITION_FIELDS`
 * records §5.5's narrower statement that `holdReason` is offered only for
 * T1/T2/T3, and is deliberately **declared-only** — see its own comment for why
 * the evaluator does not guard on it.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.4, §5.5
 */
import type { AutomationActionKind } from './automation-action.types';
import { AutomationActionValues } from './automation-action.types';
import type { AutomationConditionField } from './automation-condition.types';
import type { AutomationTrigger } from './automation-trigger.types';

/**
 * The §5.4 matrix, verbatim. Rows are triggers in T1–T8 order, columns are
 * actions in A1–A6 order; `true` is the spec's `✓`, `false` its `—`.
 *
 * Two cells are the product and should be read as such:
 * - `order.packed` → `dispatch-shipment` → `relay-status-to-source` is
 *   *"I packed it, buy the label and tell Allegro"* — the automation that
 *   justifies the wave.
 * - `order.dispatch_deadline_near` → `send-email` is the marketplace-penalty
 *   story, working on data OL has persisted and left inert for a year.
 *
 * `send-email` is legal for every trigger, deliberately: telling somebody that
 * a thing happened is meaningful whatever the thing was, and it is the one
 * action that can neither spend money nor assert something about the world.
 */
export const AUTOMATION_LEGAL_ACTIONS = {
  'order.hold.placed': {
    'issue-sales-document': false,
    'dispatch-shipment': false,
    'relay-status-to-source': false,
    'send-email': true,
    'place-hold': false,
    'release-hold': false,
  },
  'order.hold.released': {
    'issue-sales-document': true,
    'dispatch-shipment': true,
    'relay-status-to-source': true,
    'send-email': true,
    'place-hold': false,
    'release-hold': false,
  },
  'order.on_hold_for': {
    'issue-sales-document': false,
    'dispatch-shipment': false,
    'relay-status-to-source': false,
    'send-email': true,
    'place-hold': false,
    'release-hold': true,
  },
  'order.dispatch_deadline_near': {
    'issue-sales-document': false,
    'dispatch-shipment': true,
    'relay-status-to-source': false,
    'send-email': true,
    'place-hold': false,
    'release-hold': false,
  },
  'order.packed': {
    'issue-sales-document': true,
    'dispatch-shipment': true,
    'relay-status-to-source': true,
    'send-email': true,
    'place-hold': false,
    'release-hold': false,
  },
  'return.received': {
    'issue-sales-document': false,
    'dispatch-shipment': false,
    'relay-status-to-source': false,
    'send-email': true,
    'place-hold': false,
    'release-hold': false,
  },
  'return.disposed': {
    'issue-sales-document': false,
    'dispatch-shipment': false,
    'relay-status-to-source': true,
    'send-email': true,
    'place-hold': false,
    'release-hold': false,
  },
  'inventory.reservation_shortfall': {
    'issue-sales-document': false,
    'dispatch-shipment': false,
    'relay-status-to-source': false,
    'send-email': true,
    'place-hold': true,
    'release-hold': false,
  },
} as const satisfies Record<AutomationTrigger, Record<AutomationActionKind, boolean>>;

/**
 * Whether this action may follow this trigger.
 *
 * Tolerates an untrusted `trigger`: the repository CASTS an unrecognised
 * persisted trigger through rather than dropping the row (#2358), so a lookup
 * here can legitimately miss. A miss is **illegal**, which is the safe
 * direction — an unrecognised trigger must not authorise a money-spending
 * action.
 */
export function isLegalAutomationPair(trigger: string, action: string): boolean {
  const row: Record<string, boolean> | undefined = (
    AUTOMATION_LEGAL_ACTIONS as Record<string, Record<string, boolean>>
  )[trigger];
  return row?.[action] === true;
}

/** Every action legal for this trigger, in the spec's A1–A6 order. Empty for an unknown trigger. */
export function legalActionsForTrigger(trigger: string): readonly AutomationActionKind[] {
  return AutomationActionValues.filter((action) => isLegalAutomationPair(trigger, action));
}

/**
 * Which condition fields a trigger may be scoped by (spec §5.5 divergence 2:
 * `holdReason` is *"only offered for T1/T2/T3"*).
 *
 * **Declared-only — the evaluator does NOT guard on this.** A `holdReason`
 * condition on an `order.packed` rule already resolves correctly through the
 * ordinary path: the packed-order facts assert no hold reason, so the condition
 * reads `unknown` and the rule reports `condition-fact-unknown` with the
 * offending condition visible in its trace. Turning that into a separate
 * whole-rule refusal would replace an explanation the operator can act on with
 * a bare rejection, and would do it for a rule the composer could not have
 * produced. The table exists so the composer and the write-path validator can
 * refuse it at AUTHORING time, where there is an operator to tell.
 */
export const AUTOMATION_LEGAL_CONDITION_FIELDS = {
  'order.hold.placed': ['sourceConnection', 'orderCountry', 'orderTotalGross', 'holdReason'],
  'order.hold.released': ['sourceConnection', 'orderCountry', 'orderTotalGross', 'holdReason'],
  'order.on_hold_for': ['sourceConnection', 'orderCountry', 'orderTotalGross', 'holdReason'],
  'order.dispatch_deadline_near': ['sourceConnection', 'orderCountry', 'orderTotalGross'],
  'order.packed': ['sourceConnection', 'orderCountry', 'orderTotalGross'],
  'return.received': ['sourceConnection', 'orderCountry', 'orderTotalGross'],
  'return.disposed': ['sourceConnection', 'orderCountry', 'orderTotalGross'],
  'inventory.reservation_shortfall': ['sourceConnection', 'orderCountry', 'orderTotalGross'],
} as const satisfies Record<AutomationTrigger, readonly AutomationConditionField[]>;

/** Whether this condition field may be used to scope a rule on this trigger. */
export function isLegalAutomationConditionField(trigger: string, field: string): boolean {
  const fields: readonly string[] | undefined = (
    AUTOMATION_LEGAL_CONDITION_FIELDS as Record<string, readonly string[]>
  )[trigger];
  return fields?.includes(field) === true;
}
