/**
 * Splitting-limit resolution (#3057)
 *
 * Which rule, if any, is currently the one restricting how far an order may be
 * split — the fact the table's "Sets today's splitting limit" caption states.
 *
 * ## Only ACTIVE rules count
 *
 * A scheduled rule is not restricting anything yet and a retired one never will
 * again; naming either as the governing rule would tell an operator that an
 * order is limited by something the router is not applying.
 *
 * ## `quantity-split` never governs
 *
 * It is the permissive default — the answer when nothing restricts. Reporting
 * the rule that happens to declare it as "the one setting the limit" would
 * attribute the absence of a restriction to a rule, and the operator would
 * retire it expecting more splitting and see no change.
 *
 * ## Ties keep EVERY rule, and the caller may not collapse them
 *
 * Two active rules declaring the same restriction are equally responsible; an
 * operator who retires one and expects the limit to lift needs to see the other
 * named. The mockup makes every governing rule a real link for the same reason.
 *
 * @module apps/web/src/features/oms/lib
 */
import type { SourcingRule } from '../api/sourcing-rules.types';
import { resolveSourcingRuleStatus } from './sourcing-rule-status';
import {
  AFTER_ACTION_PERMISSIVENESS,
  isSourcingAfterAction,
  mostRestrictiveAfterAction,
  type SourcingAfterAction,
} from './sourcing-rule-vocabulary';

export interface SplitCeiling {
  /** The rung in force. `quantity-split` when nothing restricts. */
  ceiling: SourcingAfterAction;
  /** Ids of the active rules that declare it. Empty when nothing restricts. */
  governingRuleIds: string[];
}

export function resolveSplitCeiling(
  rules: readonly SourcingRule[],
  now: Date = new Date()
): SplitCeiling {
  const active = rules.filter(
    (rule) => resolveSourcingRuleStatus(rule, now).status === 'active'
  );
  const ceiling = mostRestrictiveAfterAction(active.map((rule) => rule.afterAction));

  if (ceiling === 'quantity-split') {
    return { ceiling, governingRuleIds: [] };
  }

  const rank = AFTER_ACTION_PERMISSIVENESS[ceiling];
  const governingRuleIds = active
    .filter(
      (rule) =>
        isSourcingAfterAction(rule.afterAction) &&
        AFTER_ACTION_PERMISSIVENESS[rule.afterAction] === rank
    )
    .map((rule) => rule.id);

  return { ceiling, governingRuleIds };
}
