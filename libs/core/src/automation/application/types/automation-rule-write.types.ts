/**
 * Automation Rule Write Input (#2358)
 *
 * What a caller supplies to create or update a rule. Distinct from the
 * `AutomationRule` entity because the caller supplies neither the id, the
 * computed `definitionHash`, nor the timestamps — the service owns all four.
 *
 * `conditions` and `actions` arrive as `unknown[]`, deliberately. They come from
 * an HTTP body (#2363) or an MCP tool, so they are untrusted until the service
 * narrows them; typing them as already-narrowed here would let a caller
 * type-assert past the only validation that exists.
 *
 * `isActive` is optional and resolves to `false` when omitted — see
 * `AutomationRule`'s docblock on failing closed.
 *
 * @module libs/core/src/automation/application/types
 */
import type { AutomationTrigger } from '../../domain/types/automation-trigger.types';

export interface AutomationRuleInput {
  readonly name: string;
  readonly trigger: AutomationTrigger;
  readonly triggerConfig: unknown;
  readonly conditions: readonly unknown[];
  readonly actions: readonly unknown[];
  /** Omitted ⇒ inactive. A rule is armed deliberately, never by default. */
  readonly isActive?: boolean;
  readonly effectiveFrom: Date;
  /** `null` = open-ended. */
  readonly effectiveTo: Date | null;
}
