/**
 * Automation Run Domain Entity (#2358, Wave-2 spec §5.6)
 *
 * One row per FIRING — including firings whose step dispatched a `sync_jobs`
 * job, so the history is complete rather than complete-for-some-actions.
 * §5.6's "one record, four readings": the order timeline, the global run log,
 * the per-rule fired log and the AF-X attention state are all renderings of
 * THIS record. They cannot be four writes — that is how a firing shows as
 * succeeded in one place and failed in another.
 *
 * Anemic and immutable per ADR-011.
 *
 * **This constructor now takes 14 positional parameters, which is at the edge of
 * readable. The NEXT member added here should convert it to an options object,
 * as its own change.** #2387 appended rather than converting because there were
 * two call sites and three sibling PRs were open on this table; that trade stops
 * paying at fifteen.
 *
 * ## Two column decisions that are contract
 *
 * **`ruleName` is FROZEN at write time, and there is no FK to `automation_rules`.**
 * §5.6 renders the rule's name on every run row, and S3-6 requires a
 * *deactivated* rule to keep its log — but rules are also deletable. An FK
 * forces a bad choice: `CASCADE` destroys history, `RESTRICT` blocks the
 * delete, and without a name on the row an orphaned run renders as a dangling
 * id. Freezing the name is the same attribution-freeze the programme already
 * applies to source attribution (#2282) and `packedByUserId`, and it makes the
 * run log honest about HISTORY rather than about the current rule table. A
 * renamed-but-alive rule stays reachable because consumers link by `ruleId`
 * and display `ruleName`.
 *
 * **`blockedByRuleIds` exists because a `blocked` run has more than one rule to
 * name.** §5.6 defines the outcome vocabulary as *"`Blocked` is the #2047
 * two-money-rules case — nothing ran, and the row says which rules collided"*,
 * and S3-3 plus the §9 ship gate both require the row to name BOTH rules. A
 * single `ruleId` can name one. It is populated **only** for
 * `outcome === 'blocked'` and is `null` otherwise; `ruleId` stays non-null on
 * every row and means *the rule whose evaluation raised the collision*, never
 * *the rule that acted* — on a blocked row nothing acted. A nullable `ruleId`
 * was rejected: a nullable discriminator invites a second reading of what a run
 * row is.
 *
 * The per-STEP outcome shape inside `steps` is **#2385's**, which also owns the
 * write path; this slice lands the table and its columns only.
 *
 * @module libs/core/src/automation/domain/entities
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.6
 */
import type { AutomationTrigger } from '../types/automation-trigger.types';
import type {
  AutomationRunOutcome,
  AutomationRunSubjectKind,
} from '../types/automation-run.types';

export class AutomationRun {
  constructor(
    public readonly id: string,
    /** The rule whose evaluation produced this run. Never null, including on `blocked`. */
    public readonly ruleId: string,
    /** Frozen at write time — history, not a live reference. See the class docblock. */
    public readonly ruleName: string,
    /** Denormalized: the rule may be deleted, and the run log has a `Trigger` column. */
    public readonly trigger: AutomationTrigger,
    public readonly subjectKind: AutomationRunSubjectKind,
    public readonly subjectId: string,
    public readonly outcome: AutomationRunOutcome,
    /** Per-step outcomes, in order. Shape owned by #2385. */
    public readonly steps: readonly unknown[],
    /** Only on `outcome === 'blocked'`: every rule that collided, this one included. */
    public readonly blockedByRuleIds: readonly string[] | null,
    public readonly firedAt: Date,
    public readonly createdAt: Date,
    /**
     * When an operator said "I handled this myself" (#2387). The row stays
     * `failed` — dismissal records that a HUMAN dealt with it, never that the
     * operation succeeded. OpenLinker must not claim it did something a person
     * did outside it.
     */
    public readonly dismissedAt: Date | null = null,
    /** Who dismissed it. Attribution only — see the ORM entity for the no-FK note. */
    public readonly dismissedByUserId: string | null = null,
    /**
     * The failed run this one is a retry OF (#2387). `null` for an ordinary
     * firing — which is what keeps a later UNRELATED firing of the same rule
     * from clearing an unrelated failure's attention state.
     */
    public readonly retryOfRunId: string | null = null,
  ) {}
}
