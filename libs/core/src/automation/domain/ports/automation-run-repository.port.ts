/**
 * Automation Run Repository Port (#2363)
 *
 * The persistence contract for `automation_runs`. **Read-only in this slice**,
 * deliberately: #2385 owns the write path and therefore owns what a run row
 * looks like when it is written. Declaring `create` here now would be declaring
 * a shape this slice cannot validate against a single real row.
 *
 * #2385 EXTENDS this port; it must not fork it. Two run-persistence contracts is
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

export interface AutomationRunRepositoryPort {
  /**
   * This rule's most recent runs, newest first, capped at `limit`.
   *
   * Served by `IDX_automation_runs_rule` (`ruleId, firedAt`), which #2358 shipped
   * with the table for exactly this read.
   */
  findRecentByRuleId(ruleId: string, limit: number): Promise<AutomationRun[]>;
}
