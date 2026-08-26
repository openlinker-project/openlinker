/**
 * Automation Rule Domain Entity (#2358, Wave-2 spec §5)
 *
 * One operator-authored automation: *when X happens, and only if …, then do Y
 * (and Z)*. Anemic and immutable per [ADR-011](../../../../../docs/architecture/adrs/011-domain-entity-behavior.md)
 * — state changes go through explicit repository methods, orchestration stays
 * in `AutomationRulesService`.
 *
 * This model **mirrors the shipped `sales_document_rules` engine (#2161/#2170)**
 * rather than inventing a second answer to "how is a rule stored and
 * evaluated": scope in real columns, kind-specific data in `jsonb`,
 * `effectiveFrom`/`effectiveTo`, an active flag, AND-only closed-vocabulary
 * conditions, and a canonicalize+hash duplicate guard whose malformed rows
 * never match rather than throwing.
 *
 * ## The three declared divergences from #2161
 *
 * Stated here, and intentional — a future reader should not "correct" them back.
 *
 * 1. **Scoped by TRIGGER, not by country.** #2161 indexes by country because the
 *    law is its scoping axis. Here the operator's mental model is *"when X
 *    happens, do Y"*, so `trigger` is the scope column and the index axis. A
 *    country index would be a category error.
 * 2. **`orderTotalGross` carries an INLINE amount + currency, not a
 *    `thresholdRef`.** #2161's indirection exists so a legal amount can version
 *    independently of the rules citing it. An automation threshold has no
 *    legal-matrix versioning concern, and forcing the operator through a
 *    separate thresholds table would be ceremony imported from a constraint
 *    that does not apply. Currency mismatch still resolves the #2161 way — no
 *    conversion, ever; the rule simply does not match.
 * 3. **Actions are an ORDERED, multi-step list capped at 3, stop-on-first-failure.**
 *    #2161 has one outcome. Consequently *several* rules may fire for one
 *    subject — except for irreversible actions (A1/A2), where the #2047
 *    at-most-one rule applies verbatim (spec §5.5 divergence 3).
 *
 * Two further divergences this slice adds, for the same "do not correct it
 * back" reason:
 *
 * - **One combined `definitionHash`, not #2170's `conditionsHash`.** The AC
 *   requires rejecting an identical *trigger+conditions+actions* rule, so the
 *   action list and `triggerConfig` are part of rule identity. Two hash columns
 *   would need two indexes and read as if they meant different things.
 * - **No `priority` column**, exactly as #2170 deliberately removed one. A
 *   priority field is a silent tie-break, and a silent tie-break on an action
 *   that spends money is precisely what the #2047 lineage exists to prevent.
 *
 * ## Column notes that are contract, not housekeeping
 *
 * - **`createdAt` is BEHAVIOURAL.** Spec §5.2: *"a rule created today acts only
 *   on facts that occur after it was saved"* (S3-9). The deadline sweep compares
 *   against this column, so it is an input to whether a rule fires — not an
 *   audit timestamp to be cleaned away.
 * - **`isActive` fails closed.** A rule that has not been deliberately armed must
 *   not spend money. The DB default is `false` as belt-and-braces, but the real
 *   enforcement point is the service: an unspecified `isActive` resolves to
 *   `false` there, because a column default only fires when the column is
 *   omitted from the INSERT and the repository always carries a boolean.
 * - **`moneyAckByUserId` / `moneyAckAt`** record spec §5.7 S3-2's
 *   acknowledgement — that an operator armed a money-spending rule they could
 *   not test first. Written by #2363. `moneyAckByUserId` is deliberately not an
 *   FK to `users` (the `packedByUserId` precedent, #2287): it is evidence of a
 *   past act, not a live reference, and deleting a user must never cascade away
 *   an operator's automation.
 *
 * @module libs/core/src/automation/domain/entities
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5
 */
import type { AutomationAction} from '../types/automation-action.types';
import { isIrreversibleAction } from '../types/automation-action.types';
import type { AutomationCondition } from '../types/automation-condition.types';
import type { AutomationTriggerConfig } from '../types/automation-trigger-config.types';
import type { AutomationTrigger } from '../types/automation-trigger.types';

export class AutomationRule {
  constructor(
    public readonly id: string,
    /** Operator-facing name. Rendered on the timeline, the run log and `{rule.name}`. */
    public readonly name: string,
    /** The scope axis (divergence 1) — a real column, and the query/index axis. */
    public readonly trigger: AutomationTrigger,
    /** Trigger-scoped parameters (T3's threshold, T4's lead time); `{}` otherwise. */
    public readonly triggerConfig: AutomationTriggerConfig,
    /** AND-ed, closed-vocabulary, order-independent. */
    public readonly conditions: readonly AutomationCondition[],
    /** Ordered, 1..3 steps, stop on first failure (divergence 3). */
    public readonly actions: readonly AutomationAction[],
    /** SHA-256 over the canonicalized `(trigger, triggerConfig, conditions, actions)`. */
    public readonly definitionHash: string,
    /** Armed or not. Fails closed; see the class docblock. */
    public readonly isActive: boolean,
    /** Date-only in the column; a `Date` in the domain, per the #2170 repository mapping. */
    public readonly effectiveFrom: Date,
    /** `null` = open-ended. */
    public readonly effectiveTo: Date | null,
    /** S3-2 money acknowledgement — who, and when. Both `null` until acknowledged. */
    public readonly moneyAckByUserId: string | null,
    public readonly moneyAckAt: Date | null,
    /** Behavioural — the retroactivity floor for the deadline sweep (S3-9). */
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  /**
   * Whether any step of this rule cannot be undone — i.e. whether the #2047
   * at-most-one rule applies to it (spec §5.5 divergence 3).
   *
   * A pure derivation over the entity's own already-loaded fields, per ADR-011.
   * Deliberately delegates to `AUTOMATION_ACTION_IS_IRREVERSIBLE` rather than
   * restating which actions those are.
   */
  hasIrreversibleAction(): boolean {
    return this.actions.some((step) => isIrreversibleAction(step.action));
  }
}
