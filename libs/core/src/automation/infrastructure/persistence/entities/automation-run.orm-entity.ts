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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
