/**
 * Automation Trigger Firing Record (#2358, Wave-2 spec §5.2 + §7.2)
 *
 * The durable at-most-once record for `deadline-sweep` triggers (T3, T4).
 * Spec §5.2: *"At most once per (rule, order), **ever**. The firing is
 * recorded, and the recorded firing is what makes the next sweep skip that
 * pair."* A duration trigger whose condition stays true for three days must not
 * fire 288 times.
 *
 * ## Why this is not folded into `automation_runs`
 *
 * **The retention policies are incompatible.** §5.6 keeps runs for **90 days**;
 * this guarantee is *forever*. A table pruned quarterly cannot enforce a
 * forever-guarantee: on day 91 the sweep re-fires for every pair it already
 * handled — and on a T4 rule wired to A2 that is a second label, bought with
 * real money, for an order that already shipped.
 *
 * **A run row is also not a firing record.** Runs are written for `blocked` and
 * `failed` outcomes too, and a `blocked` run means *nothing fired*; reusing
 * runs as the dedup key would permanently suppress a pair on which nothing ever
 * happened.
 *
 * ## The key deliberately EXCLUDES `definitionHash` — an invariant, not an oversight
 *
 * Spec §5.2: *"A rule edited to a shorter threshold may fire for orders that
 * already passed the old one; a rule edited to a longer one never un-fires.
 * **Editing a rule does not erase its firing record.**"* Keying on `ruleId`
 * alone is what makes the record survive edits.
 *
 * The obvious "improvement" a later reader will propose — add the definition
 * hash so an edited rule re-evaluates — would silently **re-arm every T3/T4 rule
 * against its entire backlog on the next edit**, buying a label per order. Do
 * not add it.
 *
 * No FK to `automation_rules`, for the same reason as `automation_runs`; and no
 * cleanup concern either, since a re-created rule gets a fresh id, so old
 * firings are inert.
 *
 * **This slice lands the table only** — #2360 owns the writer, whose insert is
 * an `ON CONFLICT DO NOTHING` against `UQ_automation_trigger_firings_rule_subject`.
 *
 * @module libs/core/src/automation/domain/entities
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.2, §7.2
 */
import type { AutomationRunSubjectKind } from '../types/automation-run.types';

export class AutomationTriggerFiring {
  constructor(
    public readonly id: string,
    public readonly ruleId: string,
    public readonly subjectKind: AutomationRunSubjectKind,
    public readonly subjectId: string,
    public readonly firedAt: Date,
    public readonly createdAt: Date,
  ) {}
}
