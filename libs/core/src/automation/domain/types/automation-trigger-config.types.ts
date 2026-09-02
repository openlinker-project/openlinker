/**
 * Automation Trigger Parameters (#2358, Wave-2 spec §5.2)
 *
 * A trigger's own parameters, kept separate from the rule's `conditions` — and
 * that split is a correctness rule rather than a filing preference.
 *
 * Spec §5.2's parameter column mixes two different things:
 *
 *  - **T1 / T2 / T7's "reason (any / specific)" / "disposition"** are assertions
 *    about the SUBJECT, and are already expressible in the condition vocabulary
 *    (`holdReason eq …`). They are not duplicated here.
 *  - **T3's "N hours/days" and T4's "X hours before"** are assertions about the
 *    TRIGGER'S OWN WINDOW. They are not facts about an order — nothing OL
 *    persists carries a `holdAgeHours` field — so modelling them as conditions
 *    would make the condition vocabulary lie about what a condition is.
 *
 * The six parameterless triggers carry `{}`. `isAutomationTriggerConfig` takes
 * the trigger so the check is exact rather than a union-wide "does it look like
 * any of these"; a malformed persisted config returns `false` and never throws,
 * matching the #2170 narrower contract.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.2
 */
import type { AutomationTrigger } from './automation-trigger.types';

/** No parameters — the six `edge` triggers plus any future parameterless one. */
export type EmptyTriggerConfig = Record<string, never>;

/** T3 — "an order has been on hold for too long". The threshold, in hours. */
export interface OnHoldForTriggerConfig {
  readonly withinHours: number;
}

/** T4 — "a marketplace dispatch deadline is close". How far ahead to look, in hours. */
export interface DispatchDeadlineNearTriggerConfig {
  readonly hoursBefore: number;
}

/**
 * The trigger-scoped parameters persisted in `automation_rules.triggerConfig`.
 *
 * Deliberately a plain union rather than a discriminated one: the discriminant
 * is the rule's own `trigger` column, which is a real column and the query
 * axis, so repeating it inside the jsonb would give it two places to drift.
 */
export type AutomationTriggerConfig =
  | EmptyTriggerConfig
  | OnHoldForTriggerConfig
  | DispatchDeadlineNearTriggerConfig;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A threshold must be a positive, finite whole number of hours. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Narrow an untrusted `triggerConfig` against the trigger it belongs to.
 *
 * Takes the trigger rather than inferring it, so a T3 threshold persisted
 * against T5 is rejected instead of quietly validating as "some known config
 * shape". Returns `false` on any mismatch; never throws.
 */
export function isAutomationTriggerConfig(
  trigger: AutomationTrigger,
  value: unknown,
): value is AutomationTriggerConfig {
  if (!isRecord(value)) return false;

  switch (trigger) {
    case 'order.on_hold_for':
      return isPositiveInteger(value.withinHours) && Object.keys(value).length === 1;
    case 'order.dispatch_deadline_near':
      return isPositiveInteger(value.hoursBefore) && Object.keys(value).length === 1;
    case 'order.hold.placed':
    case 'order.hold.released':
    case 'order.packed':
    case 'return.received':
    case 'return.disposed':
    case 'inventory.reservation_shortfall':
      return Object.keys(value).length === 0;
    default: {
      // Exhaustiveness: a ninth trigger without a config rule is a compile error.
      const exhaustive: never = trigger;
      return exhaustive;
    }
  }
}
