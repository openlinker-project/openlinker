/**
 * Automation Run ORM Entity (#2358, Wave-2 spec §5.6)
 *
 * TypeORM entity for `automation_runs` — one row per firing, and the single
 * record behind all four history renderings (§5.6's "one record, four
 * readings"). The domain contract for the frozen `ruleName` and for
 * `blockedByRuleIds` lives on the `AutomationRun` domain entity.
 *
 * **This slice lands the table only** — #2385 owns the write path and the shape
 * of a `steps` member, which is why `steps` is an unnarrowed `jsonb` here.
 *
 * **`ruleId` carries no FK to `automation_rules`**, so a deleted rule neither
 * destroys its history nor blocks its own deletion; `ruleName` and `trigger` are
 * frozen on the row so an orphaned run still renders. `subjectId` likewise
 * carries no FK — OL internal ids are `ol_*` TEXT, and the `order_changes`
 * (#2333) precedent is an indexed reference by value. `setup.ts` therefore
 * lists this table in `tablesToTruncate` explicitly: nothing cascades into it.
 *
 * **The `failed` index is PARTIAL, and that is a #2100 decision.** The
 * `/automations/activity` `outcome` filter is an operator-initiated, paged,
 * already-`firedAt`-sorted browse that the plain `firedAt` index serves. The
 * AF-X attention count is not: §4.3 makes a failed run attention-worthy, so it
 * is counted and badged on EVERY page load, on installs where the healthy
 * answer is zero. A partial index is near-empty there, so the count scans
 * nothing; a composite `(outcome, firedAt)` would instead make every routine
 * `done` row pay to speed up a filter a human triggers occasionally. Optimise
 * the query that always runs.
 *
 * @module libs/core/src/automation/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('automation_runs')
@Index('IDX_automation_runs_fired_at', ['firedAt'])
@Index('IDX_automation_runs_rule', ['ruleId', 'firedAt'])
@Index('IDX_automation_runs_subject', ['subjectKind', 'subjectId', 'firedAt'])
@Index('IDX_automation_runs_failed', ['firedAt'], { where: `"outcome" = 'failed'` })
// #2387's attention read. `IDX_automation_runs_failed` no longer matches the
// attention predicate once dismissal exists, and it is KEPT rather than replaced:
// it still serves the `outcome` browse filter, and dropping an index another
// slice landed — mid-wave, on a table three sibling PRs read — trades a small
// redundancy for a merge hazard. The overlap is a decision, not an oversight.
@Index('IDX_automation_runs_attention', ['firedAt'], {
  where: `"outcome" = 'failed' AND "dismissedAt" IS NULL`,
})
// Resolves the `NOT EXISTS` arm of the attention predicate without a scan.
@Index('IDX_automation_runs_retry_of', ['retryOfRunId'], { where: `"retryOfRunId" IS NOT NULL` })
export class AutomationRunOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The rule whose evaluation produced this run — never null, including on `blocked`. */
  @Column({ type: 'uuid' })
  ruleId!: string;

  /** Frozen at write time. History, not a live reference. */
  @Column({ type: 'text' })
  ruleName!: string;

  /** Denormalized: the rule may be deleted, and the run log has a `Trigger` column. */
  @Column({ type: 'varchar', length: 64 })
  trigger!: string;

  /** `order` | `return`. Coerced by `isAutomationRunSubjectKind` on read. */
  @Column({ type: 'varchar', length: 16 })
  subjectKind!: string;

  @Column({ type: 'text' })
  subjectId!: string;

  /** `done` | `failed` | `nothing-to-do` | `blocked`. */
  @Column({ type: 'varchar', length: 32 })
  outcome!: string;

  /**
   * Per-step outcomes, in order. Shape owned by #2385.
   *
   * The declared default matches the migration's, so a writer that omits the
   * column gets an empty list in BOTH schemas — the harness synchronizes from
   * this decorator while production runs the migration.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  steps!: unknown[];

  /**
   * Only on `outcome = 'blocked'`: every rule that collided, this one included.
   * `null` otherwise — a single `ruleId` cannot name both sides of a #2047
   * collision, which §5.6 requires the row to do.
   */
  @Column({ type: 'jsonb', nullable: true })
  blockedByRuleIds!: string[] | null;

  @Column({ type: 'timestamptz' })
  firedAt!: Date;

  /**
   * When an operator dismissed the AF-X attention state (#2387). The row's
   * `outcome` stays `failed`: only the ATTENTION clears, never the history.
   */
  @Column({ type: 'timestamptz', nullable: true })
  dismissedAt!: Date | null;

  /**
   * Who dismissed it. **No FK**, following `automation_rules.moneyAckByUserId`
   * on the sibling table: this is display + attribution, and a deleted user must
   * neither destroy run history nor block its own deletion.
   */
  @Column({ type: 'uuid', nullable: true })
  dismissedByUserId!: string | null;

  /**
   * The failed run this row is a retry of (#2387). Self-reference **by value,
   * no FK** — the same treatment `subjectId` and `ruleId` already get here.
   *
   * It exists because a derived attention state is only self-clearing if the
   * derivation can SEE what clears it: a retry INSERTs a new row and never
   * touches the original, so without this link the original stays
   * attention-worthy forever. Latest-run-wins at `(subjectId, ruleId)` was
   * rejected — it would clear on a later UNRELATED firing of the same rule.
   */
  @Column({ type: 'uuid', nullable: true })
  retryOfRunId!: string | null;

  /**
   * This run's position in its retry chain (#2666) — `0` for an ordinary
   * firing, the parent's value plus one for a retry.
   *
   * The declared default MUST match the migration's, because the integration
   * harness synchronizes schema from this decorator while production runs the
   * migration — the same rule stated on `steps` above. Existing rows take the
   * migration's `DEFAULT 0`, which understates a chain's history rather than
   * overstating it: a fresh budget, never a legitimate retry refused.
   */
  @Column({ type: 'int', default: 0 })
  retryAttempt!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
