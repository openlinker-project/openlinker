/**
 * Automation Trigger Vocabulary (#2358, Wave-2 spec §5.2)
 *
 * The eight v1 triggers — closed, and versioned with the code. There is no
 * operator-extensible trigger vocabulary in v1: every member names a fact
 * OpenLinker **persists**, at a grain OpenLinker **writes**, in a wave that has
 * already shipped by Wave 2 (spec §5.2's admission rule).
 *
 * **The firing mode is declared here, not inferred.** Without it a *standing*
 * condition like `inventory.reservation_shortfall` — true until somebody fixes
 * it — is level-triggered, and a naive implementation re-evaluates it on every
 * recompute and emails about it hourly, forever. `edge` fires once per
 * transition; `deadline-sweep` fires when a clock crosses a persisted
 * timestamp, and is the ONLY mode that must consult `automation_trigger_firings`
 * for its at-most-once-per-(rule, subject) guarantee.
 *
 * The `satisfies` on the mode map is load-bearing: a ninth trigger added
 * without a mode is a compile error rather than a trigger that silently never
 * fires.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.2
 */

/**
 * The eight v1 triggers, in the spec's own T1–T8 order.
 *
 * - `order.hold.placed`               — T1, an order is put on hold.
 * - `order.hold.released`             — T2, a hold is lifted.
 * - `order.on_hold_for`               — T3, on hold longer than a threshold.
 * - `order.dispatch_deadline_near`    — T4, a marketplace dispatch deadline is close.
 * - `order.packed`                    — T5, an order is marked packed.
 * - `return.received`                 — T6, returned goods arrive.
 * - `return.disposed`                 — T7, a return is restocked or scrapped.
 * - `inventory.reservation_shortfall` — T8, more promised than held.
 */
export const AutomationTriggerValues = [
  'order.hold.placed',
  'order.hold.released',
  'order.on_hold_for',
  'order.dispatch_deadline_near',
  'order.packed',
  'return.received',
  'return.disposed',
  'inventory.reservation_shortfall',
] as const;

export type AutomationTrigger = (typeof AutomationTriggerValues)[number];

/**
 * Coerce an untrusted value (a persisted column, a request DTO) to the union.
 * Pure; no default — an unrecognised trigger must surface as "not a trigger"
 * rather than silently becoming one that fires.
 */
export function isAutomationTrigger(value: unknown): value is AutomationTrigger {
  return (
    typeof value === 'string' && (AutomationTriggerValues as readonly string[]).includes(value)
  );
}

/**
 * How a trigger fires (spec §5.2, "the two kinds").
 *
 * - `edge`           — fires on the transition, once per transition. The firing is
 *                      caused by the WRITE that creates the fact, so re-reading,
 *                      re-ingesting or recomputing the same fact fires nothing.
 * - `deadline-sweep` — fires when a clock crosses a persisted timestamp. There is no
 *                      event to hang it on, so a periodic evaluator is required — and
 *                      the parameter is a THRESHOLD, not a schedule.
 */
export const AutomationTriggerFiringModeValues = ['edge', 'deadline-sweep'] as const;
export type AutomationTriggerFiringMode = (typeof AutomationTriggerFiringModeValues)[number];

/**
 * The mode of each trigger, verbatim from spec §5.2.
 *
 * **This map is what tells #2360 which triggers must consult
 * `automation_trigger_firings`.** Exactly two are `deadline-sweep`; the other
 * six are caused by a write and need no firing record, because the write
 * happens once.
 */
export const AUTOMATION_TRIGGER_FIRING_MODE = {
  'order.hold.placed': 'edge',
  'order.hold.released': 'edge',
  'order.on_hold_for': 'deadline-sweep',
  'order.dispatch_deadline_near': 'deadline-sweep',
  'order.packed': 'edge',
  'return.received': 'edge',
  'return.disposed': 'edge',
  'inventory.reservation_shortfall': 'edge',
} as const satisfies Record<AutomationTrigger, AutomationTriggerFiringMode>;

/** Whether this trigger fires from a clock crossing a timestamp rather than from a write. */
export function isDeadlineSweepTrigger(trigger: AutomationTrigger): boolean {
  return AUTOMATION_TRIGGER_FIRING_MODE[trigger] === 'deadline-sweep';
}
