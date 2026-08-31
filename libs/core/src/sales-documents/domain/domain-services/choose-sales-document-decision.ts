/**
 * Choose a Sales-Document Decision (#2516, ADR-041 decision 5 / #2173)
 *
 * The two-step precedence that turns a rule-engine answer plus the install's
 * candidate connections into AT MOST ONE `SalesDocumentDecision`. Pure - no
 * NestJS, no I/O, no order read.
 *
 * It exists because that precedence now has TWO callers with the same
 * question. `AutoIssueTriggerService` asks it to decide what to issue;
 * the per-order sales-document projection (ADR-065) asks it to state which
 * document an order that has none yet is routed to. A surface that answered
 * differently from the gate would be telling an operator something the system
 * will not do, so the two read one function rather than two copies of a rule.
 *
 * The precedence itself is #2173's, carried over unchanged:
 *
 *  1. Any rule-engine decision OTHER than `unresolved`/
 *     `'no-configuration-for-country'` is returned AS-IS - a `route`, an
 *     `aggregate`, or a different `unresolved` reason all flow onward, so
 *     "surface it, never silently fall back" stays automatic.
 *  2. Only `'no-configuration-for-country'` - or no rule-engine answer at all,
 *     which is what a caller passes when the order carries no country to
 *     evaluate - falls back to the pre-#2170 `operator-configured`
 *     single-primary model.
 *  3. `null` means "nothing to route with at all": no candidate carries a
 *     configured `documentKind`. That short-circuit is deliberate and not the
 *     same as `unresolved` - see `resolveSalesDocumentRouting`'s own note on
 *     its zero-candidate branch being a defensive fallback rather than the
 *     common path.
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import type { SalesDocumentDecision } from '../types/sales-document-decision.types';
import type { SalesDocumentRoutingCandidate } from './resolve-sales-document-routing';
import { resolveSalesDocumentRoutingFromCandidates } from './resolve-sales-document-routing';

export interface ChooseSalesDocumentDecisionInput {
  /**
   * What the country-agnostic rule engine answered, or `null` when it was not
   * consulted at all (the order carries no country to evaluate against).
   * `null` and `'no-configuration-for-country'` are treated identically here,
   * which is exactly how the gate has always treated them.
   */
  readonly ruleDecision: SalesDocumentDecision | null;
  /** Every connection that could receive this order's originating document. */
  readonly candidates: readonly SalesDocumentRoutingCandidate[];
}

/** Narrow a rule-engine decision to "the engine has no configuration at all for this order's country". */
export function isNoConfigurationForCountry(decision: SalesDocumentDecision): boolean {
  return decision.kind === 'unresolved' && decision.reason === 'no-configuration-for-country';
}

/**
 * Count candidates the fallback resolver could route to.
 *
 * Deliberately `documentKind !== null` rather than
 * `resolve-sales-document-routing`'s own `isEligibleCandidate` (which also
 * admits a self-routing candidate): this is the gate's pre-existing
 * short-circuit predicate, carried over byte-for-byte. No adapter in the repo
 * declares `SelfRoutingDocumentKind` (#2158 shipped the mechanism, not a
 * consumer), so the two predicates cannot disagree today - widening it here
 * would be an untested behaviour change smuggled into a refactor.
 */
function countRoutableCandidates(candidates: readonly SalesDocumentRoutingCandidate[]): number {
  return candidates.filter((candidate) => candidate.documentKind !== null).length;
}

/**
 * Resolve EXACTLY ONE `SalesDocumentDecision`, or `null` for "nothing to route
 * with at all".
 */
export function chooseSalesDocumentDecision(
  input: ChooseSalesDocumentDecisionInput,
): SalesDocumentDecision | null {
  const { ruleDecision, candidates } = input;

  if (ruleDecision !== null && !isNoConfigurationForCountry(ruleDecision)) {
    return ruleDecision;
  }

  if (countRoutableCandidates(candidates) === 0) {
    return null;
  }

  return resolveSalesDocumentRoutingFromCandidates(candidates);
}
