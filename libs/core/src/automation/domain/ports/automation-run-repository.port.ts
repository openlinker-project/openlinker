/**
 * Automation Run Repository Port (#2363, write path added by #2385)
 *
 * The persistence contract for `automation_runs`. #2363 declared it read-only
 * on the grounds that #2385 owns the write path and therefore owns what a run
 * row looks like when it is written; #2385 EXTENDED it here, as instructed. Two run-persistence contracts is
 * how a firing renders one way in the run log and another in the timeline, which
 * §5.6's "one record, four readings" exists to prevent.
 *
 * Consumed only from INSIDE this context, by `AutomationRunsReadService` — a
 * `*RepositoryPort` is an intra-context contract, and cross-context callers (the
 * #2363 controller included) go through `I*Service`
 * (`architecture-overview.md § Cross-context dependencies in core`).
 *
 * @module libs/core/src/automation/domain/ports
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.6
 */
import type { AutomationRun } from '../entities/automation-run.entity';
import type { AutomationRunOutcome, AutomationRunSubjectKind } from '../types/automation-run.types';
import type { AutomationTrigger } from '../types/automation-trigger.types';

/**
 * A run about to be written (#2385).
 *
 * **Deliberately NOT `AutomationRun`.** The entity's constructor requires `id`
 * and `createdAt`, but `automation_runs.id` is `@PrimaryGeneratedColumn('uuid')`
 * and `createdAt` is DB-defaulted — so accepting the entity would force the
 * caller to invent two values the database owns, and the `createdAt` would be
 * the application's clock standing in for the row's.
 *
 * `firedAt` is different and IS supplied: it is when the firing happened, which
 * only the dispatcher knows.
 *
 * `ruleName` is denormalised on purpose (#2358): the id alone would make a
 * DELETED rule's history unreadable, which is precisely when it is most needed.
 * It is frozen at write time, so renaming a rule never rewrites history.
 */
export interface NewAutomationRun {
  readonly ruleId: string;
  readonly ruleName: string;
  readonly trigger: AutomationTrigger;
  readonly subjectKind: AutomationRunSubjectKind;
  readonly subjectId: string;
  readonly outcome: AutomationRunOutcome;
  /** Persisted verbatim into the existing `steps` jsonb — widened, never forked. */
  readonly steps: readonly unknown[];
  readonly blockedByRuleIds: readonly string[] | null;
  readonly firedAt: Date;
}

export interface AutomationRunRepositoryPort {
  /**
   * Persist one firing and return the row as written.
   *
   * Returns the persisted entity rather than `void` so the caller reads the
   * database-assigned `id` and `createdAt` back instead of guessing them.
   */
  save(run: NewAutomationRun): Promise<AutomationRun>;

  /**
   * Recent runs against one subject (an order, a return), newest first.
   *
   * Served by `IDX_automation_runs_subject` (`subjectKind, subjectId, firedAt`),
   * which #2358 shipped for exactly this read — the order timeline's source.
   */
  findRecentBySubject(
    subjectKind: AutomationRunSubjectKind,
    subjectId: string,
    limit: number,
  ): Promise<AutomationRun[]>;

  /** One run by id, or `null`. */
  findById(id: string): Promise<AutomationRun | null>;

  /** Recent runs across every rule, newest first — the activity list. */
  findRecent(limit: number, offset: number): Promise<AutomationRun[]>;

  /**
   * This rule's most recent runs, newest first, capped at `limit`.
   *
   * Served by `IDX_automation_runs_rule` (`ruleId, firedAt`), which #2358 shipped
   * with the table for exactly this read.
   */
  findRecentByRuleId(ruleId: string, limit: number): Promise<AutomationRun[]>;
}
