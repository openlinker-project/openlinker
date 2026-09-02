/**
 * Automation Rule Definition Hash (#2358, Wave-2 spec §5.5)
 *
 * The canonicalization + hash that back the save-time duplicate guard —
 * mirroring `computeSalesDocumentConditionsHash` (#2170) in shape, with one
 * declared divergence.
 *
 * **#2170 hashes CONDITIONS; this hashes the whole DEFINITION.** There, the
 * outcome is a single `(documentKind, connectionId)` pair that is not part of
 * rule identity. Here the AC is explicit — "rejects an identical
 * trigger+conditions+actions rule" — so the action list IS part of identity, and
 * so is `triggerConfig` (two rules differing only in threshold are genuinely
 * different rules). All of it goes into ONE hash: two hash columns would need
 * two indexes and invite a reader to believe they mean different things.
 *
 * `trigger` stays a real column rather than being folded in — it is the query
 * axis and the §5.5 divergence-1 scope axis, exactly as `country` is in #2170.
 * It is included in the hash input too, harmlessly, so the canonical string is
 * a complete description of the rule.
 *
 * **Conditions are sorted; actions are NOT.** Action order is semantic — "run
 * in order, stop on first failure" — so A2→A3 (buy the label, then tell the
 * marketplace) and A3→A2 (tell the marketplace, then buy a label it was never
 * told about) are different rules and must hash differently. Conditions are
 * AND-ed, so their authoring order carries no meaning and sorting them is what
 * makes the guard catch a re-ordered duplicate.
 *
 * Imports only `node:crypto` — a Node builtin, not a framework and not a
 * sibling core barrel.
 *
 * @module libs/core/src/automation/domain/types
 * @see docs/specs/product-spec-oms-wave2-operator-experience.md §5.5
 */
import { createHash } from 'node:crypto';

import type { AutomationAction } from './automation-action.types';
import type { AutomationCondition } from './automation-condition.types';
import type { AutomationTriggerConfig } from './automation-trigger-config.types';
import type { AutomationTrigger } from './automation-trigger.types';

/** Everything that makes two automation rules "the same rule". */
export interface AutomationRuleDefinition {
  readonly trigger: AutomationTrigger;
  readonly triggerConfig: AutomationTriggerConfig;
  readonly conditions: readonly AutomationCondition[];
  readonly actions: readonly AutomationAction[];
}

/** Recursively re-emit an object with its keys in sorted order. */
function withSortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (typeof value !== 'object' || value === null) return value;

  const source = value as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    ordered[key] = withSortedKeys(source[key]);
  }
  return ordered;
}

/**
 * Canonical serialization of a rule definition — the input to
 * {@link computeAutomationDefinitionHash}.
 *
 * Conditions are sorted by field (order-independent, since they are AND-ed);
 * actions keep their authored order (order-dependent by contract); every
 * object's keys are sorted recursively, so a nested `recipient` or a differently
 * key-ordered `dispatch-shipment` config cannot produce a different hash for the
 * same rule.
 */
export function canonicalizeAutomationDefinition(definition: AutomationRuleDefinition): string {
  const conditions = [...definition.conditions]
    .sort((a, b) => a.field.localeCompare(b.field))
    .map(withSortedKeys);

  return JSON.stringify({
    trigger: definition.trigger,
    triggerConfig: withSortedKeys(definition.triggerConfig),
    conditions,
    actions: definition.actions.map(withSortedKeys),
  });
}

/**
 * `automation_rules.definitionHash` — the duplicate guard's join key. A plain
 * SHA-256 hex digest of {@link canonicalizeAutomationDefinition}, computed in
 * application code rather than a DB generated column (the semantic
 * effective-range overlap check cannot be a trigger either — see the write-path
 * service).
 */
export function computeAutomationDefinitionHash(definition: AutomationRuleDefinition): string {
  return createHash('sha256').update(canonicalizeAutomationDefinition(definition)).digest('hex');
}
