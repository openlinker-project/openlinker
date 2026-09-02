/**
 * Choose a Sales-Document Decision (#2516, ADR-041 decision 5 / #2173,
 * fallback retired by the "opcja b" decision)
 *
 * Pure - no NestJS, no I/O, no order read.
 *
 * It exists because this question now has TWO callers. `AutoIssueTriggerService`
 * asks it to decide what to issue; the per-order sales-document projection
 * (ADR-065) asks it to state which document an order that has none yet is
 * routed to. A surface that answered differently from the gate would be
 * telling an operator something the system will not do, so the two read one
 * function rather than two copies of a rule.
 *
 * **The operator-configured single-primary fallback is REMOVED.** A country
 * with no rule-engine configuration - no matching rule, no country default,
 * no ★ Rest of world default - now ALWAYS resolves to the rule engine's own
 * `unresolved` / `'no-configuration-for-country'` answer (or `null` when the
 * order carried no country to evaluate at all), never to a connection picked
 * via `config.invoicing.isPrimary`. The previous two-step precedence silently
 * routed such an order through a "primary" connection the operator may not
 * have configured with that country in mind at all - the rule engine is the
 * ONLY sanctioned way to make a country auto-issue; anything else is manual.
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import type { SalesDocumentDecision } from '../types/sales-document-decision.types';
import type { SalesDocumentRoutingCandidate } from './resolve-sales-document-routing';

export interface ChooseSalesDocumentDecisionInput {
  /**
   * What the country-agnostic rule engine answered, or `null` when it was not
   * consulted at all (the order carries no country to evaluate against).
   * `null` and `'no-configuration-for-country'` are treated identically here,
   * which is exactly how the gate has always treated them: both mean "no
   * rule-engine configuration exists for this order", and now both resolve to
   * manual - there is no second resolver left to fall back to.
   */
  readonly ruleDecision: SalesDocumentDecision | null;
  /**
   * Unused since the single-primary fallback was retired. Kept on the input
   * shape so existing call sites (which still compute the candidate list for
   * `reportUnresolved`'s own detail text) don't need a second, narrower type.
   */
  readonly candidates: readonly SalesDocumentRoutingCandidate[];
}

/** Narrow a rule-engine decision to "the engine has no configuration at all for this order's country". */
export function isNoConfigurationForCountry(decision: SalesDocumentDecision): boolean {
  return decision.kind === 'unresolved' && decision.reason === 'no-configuration-for-country';
}

/**
 * Resolve EXACTLY ONE `SalesDocumentDecision`, or `null` for "nothing to route
 * with at all" (no rule-engine answer - the order carried no country).
 *
 * No fallback: `'no-configuration-for-country'` is returned AS-IS rather than
 * resolved against `config.invoicing.isPrimary` - see the module doc comment.
 */
export function chooseSalesDocumentDecision(
  input: ChooseSalesDocumentDecisionInput,
): SalesDocumentDecision | null {
  return input.ruleDecision;
}
