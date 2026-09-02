/**
 * OL Router — the routing rule shape and its coercer
 *
 * A routing ruleset is an operator-authored, ordered list of rules drawn from
 * the closed vocabulary. Rules are persisted as **rows** in `oms_routing_rules`
 * — never in a `Connection.config.routing` jsonb blob. ADR-054's adopted
 * storage amendment (2026-08-23, #2298) supersedes the config sentence the
 * issue title still repeats, and the prohibition is already stated in merged
 * code: see `authority-config.types.ts`, which forbids extending the authority
 * coercer to reach routing rules. Rows win because a `RoutingExplanationStep`
 * has to cite a **stable rule id** that survives the operator reordering the
 * list, which an array inside a config blob cannot offer.
 *
 * The coercer therefore narrows an untrusted **persisted column**, exactly as
 * `isSalesDocumentCondition` does, rather than a config blob.
 *
 * ## Why runtime functions live in a `*.types.ts`
 *
 * This file invokes the pure-rule exception in
 * `docs/engineering-standards.md` § "The pure-rule exception to 'types only'
 * (#2231)", and satisfies all three conditions: the functions are **pure** (no
 * I/O, no dependency, no argument mutation); they **are** the rule for the type
 * they sit with (they coerce an untrusted value into it); and **both halves
 * change together** — adding a vocabulary member means editing the guard in the
 * same commit. This is the `readPricingRule` / `readStockSafetyBuffer`
 * precedent, one layer removed from config.
 *
 * ## A malformed rule never matches, and never throws
 *
 * Routing decides where a seller's stock is committed from, so a rule this
 * build cannot parse must not be guessed at. A malformed row is **dropped**; a
 * wholly malformed collection yields `[]`, which the router reports as "no
 * rules configured" and which leaves the install byte-identical to having no
 * router at all. Throwing would turn one bad row into a failed job.
 *
 * @module libs/oms/src/routing
 */

import {
  RoutingAfterActionValues,
  RoutingFilterNameValues,
  RoutingSortNameValues,
  type RoutingAfterAction,
  type RoutingFilterName,
  type RoutingSortName,
} from './routing-vocabulary.types';

/** Fields every rule carries, whatever its kind. */
export interface RoutingRuleBase {
  /**
   * The row's stable identity. A persisted `RoutingExplanationStep` cites this,
   * so it must survive the operator reordering or renaming the list — which is
   * the reason rules are rows and not a config array.
   */
  readonly id: string;
  /** Ascending evaluation order within a connection's ruleset. */
  readonly position: number;
  readonly afterAction: RoutingAfterAction;
}

export interface RoutingFilterRule extends RoutingRuleBase {
  readonly kind: 'filter';
  readonly name: RoutingFilterName;
}

export interface RoutingSortRule extends RoutingRuleBase {
  readonly kind: 'sort';
  readonly name: RoutingSortName;
  /**
   * Operator-authored location order, read only by the `priority` sort. Empty
   * for every other sort — and an empty list makes `priority` rank nothing,
   * which the explanation step reports rather than silently passing through.
   */
  readonly priorityLocationIds: readonly string[];
}

export type RoutingRule = RoutingFilterRule | RoutingSortRule;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isNonEmptyString);
}

/**
 * Narrow one untrusted persisted row into a `RoutingRule`, or report that it is
 * not one. Never throws.
 */
export function isRoutingRule(value: unknown): value is RoutingRule {
  return coerceRoutingRule(value) !== null;
}

/**
 * Coerce a single untrusted row, returning `null` when it does not match. A
 * near-miss is still a miss: an unrecognised name, kind or after-action is a
 * rule this build does not understand, and routing on a partial understanding
 * of it would commit stock somewhere the operator did not ask for.
 */
export function coerceRoutingRule(value: unknown): RoutingRule | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, position, kind, name, afterAction } = value;

  if (!isNonEmptyString(id)) {
    return null;
  }
  if (typeof position !== 'number' || !Number.isFinite(position)) {
    return null;
  }
  if (!RoutingAfterActionValues.includes(afterAction as RoutingAfterAction)) {
    return null;
  }

  const base: RoutingRuleBase = { id, position, afterAction: afterAction as RoutingAfterAction };

  if (kind === 'filter') {
    if (!RoutingFilterNameValues.includes(name as RoutingFilterName)) {
      return null;
    }
    return { ...base, kind: 'filter', name: name as RoutingFilterName };
  }

  if (kind === 'sort') {
    if (!RoutingSortNameValues.includes(name as RoutingSortName)) {
      return null;
    }
    return {
      ...base,
      kind: 'sort',
      name: name as RoutingSortName,
      priorityLocationIds: readStringArray(value.priorityLocationIds),
    };
  }

  return null;
}

/**
 * Coerce a whole persisted ruleset, dropping every row this build cannot
 * understand and ordering the survivors by `position`.
 *
 * Ties are broken by `id` so that two rules sharing a position evaluate in a
 * deterministic order — routing must not depend on the order the database
 * happened to return rows in.
 */
export function coerceRoutingRules(value: unknown): readonly RoutingRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rules: RoutingRule[] = [];
  for (const candidate of value) {
    const rule = coerceRoutingRule(candidate);
    if (rule !== null) {
      rules.push(rule);
    }
  }

  return rules.sort((a, b) => (a.position === b.position ? a.id.localeCompare(b.id) : a.position - b.position));
}
