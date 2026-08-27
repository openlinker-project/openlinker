/**
 * Automation Rule Repository Port (#2358)
 *
 * The persistence contract for `automation_rules`. Minimal by design —
 * only what the application layer actually needs, never a mirror of TypeORM's
 * `Repository<T>` API (engineering-standards § Repository Ports Pattern).
 *
 * `findByTriggerAndDefinitionHash` exists solely to back the save-time
 * duplicate guard: it returns every candidate sharing the definition so the
 * service can apply the effective-range overlap test in the domain rather than
 * pushing date arithmetic into SQL.
 *
 * `findActiveByTrigger` is the read #2359/#2360 evaluate against; it is here now
 * because the index that serves it (`IDX_automation_rules_trigger_active`) ships
 * with the table, and a port method costs nothing while a missing index costs a
 * migration slot.
 *
 * @module libs/core/src/automation/domain/ports
 */
import type { AutomationRule } from '../entities/automation-rule.entity';
import type { AutomationTrigger } from '../types/automation-trigger.types';
import type { AutomationAction } from '../types/automation-action.types';
import type { AutomationCondition } from '../types/automation-condition.types';
import type { AutomationTriggerConfig } from '../types/automation-trigger-config.types';

/**
 * What the service hands the repository once it has validated and hashed —
 * narrowed vocabularies, not the caller's `unknown[]`. Mirrors #2170's
 * `SalesDocumentRuleInput & { conditionsHash }`.
 */
export interface AutomationRulePersistInput {
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly triggerConfig: AutomationTriggerConfig;
  readonly conditions: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
  readonly definitionHash: string;
  readonly isActive: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
}

export interface AutomationRuleRepositoryPort {
  findById(id: string): Promise<AutomationRule | null>;

  /** Every rule on this trigger, active or not — the per-trigger index page. */
  findByTrigger(trigger: AutomationTrigger): Promise<AutomationRule[]>;

  /**
   * Active rules on this trigger whose effective window contains `on`.
   * The evaluator's read (#2359/#2360).
   */
  findActiveByTrigger(trigger: AutomationTrigger, on: Date): Promise<AutomationRule[]>;

  /** Duplicate-guard candidates: same trigger, same definition, any window. */
  findByTriggerAndDefinitionHash(
    trigger: AutomationTrigger,
    definitionHash: string,
  ): Promise<AutomationRule[]>;

  /** Rule counts per trigger, for the §5.5 divergence-1 trigger index table. */
  countRulesByTrigger(): Promise<Map<AutomationTrigger, number>>;

  /** Throws `AutomationRuleConflictError` on the unique-index violation. */
  create(input: AutomationRulePersistInput): Promise<AutomationRule>;

  /** Throws `AutomationRuleConflictError` on the unique-index violation. */
  update(id: string, input: AutomationRulePersistInput): Promise<AutomationRule>;

  delete(id: string): Promise<void>;

  /**
   * Stamp or clear the §5.7 S3-2 money acknowledgement (#2363).
   *
   * A dedicated write rather than two more fields on `AutomationRulePersistInput`:
   * the ack is evidence about a past operator act, and the persist input is what
   * the `definitionHash` is computed over — putting the ack inside it would make
   * the acknowledgement part of the identity it is evidence ABOUT, so every
   * acknowledgement would change the hash and clear itself.
   *
   * @throws {AutomationRuleNotFoundError}
   */
  setMoneyAck(id: string, byUserId: string | null, at: Date | null): Promise<AutomationRule>;
}
