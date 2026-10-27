/**
 * Draft Rule Evaluator (guard-only sub-capability of the OL fulfilment router, #2954)
 *
 * Lets a caller dry-run the SAME order through an unsaved ruleset, so an
 * operator can compare "saved" against "what I am about to save" before arming
 * it. It is deliberately NOT a parameter of core's `FulfillmentRouterPort`:
 * routing rules are `@openlinker/oms` vocabulary, and REVIEW H7 keeps them
 * opaque across that port.
 *
 * `route()` never takes a rule override - a committing call can therefore never
 * be handed a draft, and a draft is never persisted by this seam.
 *
 * @module libs/oms/src/routing
 */
import type { RoutingEvaluation, RoutingInput } from '@openlinker/core/fulfillment';

import type { RoutingRule } from './routing-rule.types';

export interface DraftRuleComparison {
  readonly saved: RoutingEvaluation;
  readonly draft: RoutingEvaluation;
}

export interface DraftRuleEvaluator {
  /**
   * Non-committing evaluation of the SAME order under the saved ruleset and under
   * `rules`, both over ONE snapshot of the facts (locations, stock, rejections).
   *
   * One snapshot is the point: two independent evaluations each read stock, so a
   * stock change between them would show up as "this line would move" when no
   * rule caused it - a false statement about the operator's own configuration.
   */
  evaluateAgainstDraft(
    input: RoutingInput,
    rules: readonly RoutingRule[]
  ): Promise<DraftRuleComparison>;
}

export function isDraftRuleEvaluator<T extends object>(
  router: T
): router is T & DraftRuleEvaluator {
  return typeof (router as Partial<DraftRuleEvaluator>).evaluateAgainstDraft === 'function';
}
