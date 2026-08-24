/**
 * Evaluate Sales-Document Rules (#2170, ADR-041 decision 5, narrowed)
 *
 * The country-agnostic rule engine ADR-041 decision 5 deferred and #2170
 * ships: given an order-fact PROJECTION (never the `Order` entity, never an
 * injected `orders`/`customers` token — see `SalesDocumentOrderFacts`'s own
 * doc comment) plus the caller-loaded rules/defaults for the order's own
 * country and for `★ Rest of world`, resolves AT MOST ONE
 * `(documentKind, connectionId)` pair through the four-tier fallback ladder:
 *
 *   1. A rule match for the order's own country.
 *   2. No match → the country's own default (when exactly one is configured).
 *   3. The country carries NO rules and NO defaults at all → fall through to
 *      `★ Rest of world`, evaluated by the identical two tiers.
 *   4. Nothing above applies → `unresolved`, `no-configuration-for-country`.
 *
 * Plain function, no NestJS, no I/O — the caller (a future application
 * service) is responsible for loading the country's rules/defaults, `★ Rest of
 * world`'s rules/defaults, and every `SalesDocumentThresholdFact` any loaded
 * rule's conditions reference, and for supplying `now` explicitly (never
 * `new Date()` inside a pure function) so effective-date filtering stays
 * deterministic and testable.
 *
 * NO PRIORITY FIELD (#2170's deliberate narrowing of ADR-041 decision 5's own
 * sketch): two rules in the SAME scope that both match the SAME order resolve
 * `unresolved`/`conflicting-rules-equal-priority` — there is no priority
 * number to silently pick a winner with. This is DISTINCT from the save-time
 * conflict guard (`assertNoSalesDocumentRuleConflict`), which rejects two
 * rules sharing the identical `conditionsHash`; two rules with DIFFERENT
 * conditions can still both legitimately match one real order (e.g. "buyer
 * has no tax id" and "order country is PL" could both be true at once), and
 * that is exactly the runtime ambiguity this reason exists to catch.
 *
 * NEVER A SILENT FX CONVERSION: an `orderTotalGross` condition's referenced
 * threshold is compared against the order's OWN `currency` with no conversion
 * step. A currency mismatch resolves `unresolved`/`threshold-currency-mismatch`
 * — the existing FX stamp (ADR-040) is analytics-only and explicitly forbidden
 * as a fiscal-document rate source, so this evaluator must never reach for it
 * (and does not import anything that could).
 *
 * @module libs/core/src/sales-documents/domain/domain-services
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import type { SalesDocumentDecision } from '../types/sales-document-decision.types';
import type { SalesDocumentCondition } from '../types/sales-document-condition.types';
import {
  SALES_DOCUMENT_REST_OF_WORLD_COUNTRY,
  type SalesDocumentCountryDefaultFact,
  type SalesDocumentOrderFacts,
  type SalesDocumentRuleFact,
  type SalesDocumentThresholdFact,
} from '../types/sales-document-order-facts.types';

export interface SalesDocumentRuleEngineInput {
  readonly order: SalesDocumentOrderFacts;
  /** Rules scoped to the order's own country, already loaded by the caller. */
  readonly countryRules: readonly SalesDocumentRuleFact[];
  /** Country defaults for the order's own country. */
  readonly countryDefaults: readonly SalesDocumentCountryDefaultFact[];
  /** Rules scoped to `★ Rest of world` (`SALES_DOCUMENT_REST_OF_WORLD_COUNTRY`). */
  readonly restOfWorldRules: readonly SalesDocumentRuleFact[];
  /** Country defaults for `★ Rest of world`. */
  readonly restOfWorldDefaults: readonly SalesDocumentCountryDefaultFact[];
  /** Every threshold any loaded rule's conditions may reference, keyed by `ref`. */
  readonly thresholds: readonly SalesDocumentThresholdFact[];
  /** Evaluation instant for effective-date filtering — never read from the system clock inside this function. */
  readonly now: Date;
}

type ScopeResult =
  | { kind: 'route'; documentKind: string; connectionId: string }
  | { kind: 'no-match' }
  | { kind: 'ambiguous-rules' }
  | { kind: 'ambiguous-defaults' }
  | { kind: 'net-priced' }
  | { kind: 'currency-mismatch' };

function isEffective(rule: SalesDocumentRuleFact, now: Date): boolean {
  if (rule.effectiveFrom.getTime() > now.getTime()) return false;
  if (rule.effectiveTo !== null && rule.effectiveTo.getTime() < now.getTime()) return false;
  return true;
}

/** Terminal signal from evaluating a single `orderTotalGross` condition, or `null` when it evaluates cleanly. */
function checkAmountConditionDataProblem(
  order: SalesDocumentOrderFacts,
  threshold: SalesDocumentThresholdFact | undefined,
): 'net-priced' | 'currency-mismatch' | null {
  if (threshold === undefined) {
    // Referential-integrity gap (a rule cites a thresholdRef the caller did
    // not load) — never a data problem worth halting the whole evaluation
    // over. The condition simply cannot be evaluated, so the rule that
    // carries it cannot match; other rules in the same scope are unaffected.
    return null;
  }
  // A missing `taxTreatment` is NOT "known to be inclusive" — the type's own
  // doc comment (`SalesDocumentOrderFacts.taxTreatment`) says a missing OR
  // `exclusive` treatment resolves the same way, and this codebase's stance
  // is to never guess on a figure feeding a legal-document decision (review
  // finding 11). Only an EXPLICIT `'inclusive'` clears this check.
  if (order.taxTreatment !== 'inclusive') {
    return 'net-priced';
  }
  if (threshold.currency !== order.currency) {
    return 'currency-mismatch';
  }
  return null;
}

function evaluateCondition(
  condition: SalesDocumentCondition,
  order: SalesDocumentOrderFacts,
  thresholdsByRef: ReadonlyMap<string, SalesDocumentThresholdFact>,
): { matches: boolean; dataProblem: 'net-priced' | 'currency-mismatch' | null } {
  if (condition.field === 'buyerHasTaxId') {
    return { matches: order.buyerHasTaxId === condition.value, dataProblem: null };
  }
  if (condition.field === 'orderCountry') {
    return { matches: order.country === condition.value, dataProblem: null };
  }
  // condition.field === 'orderTotalGross'
  const threshold = thresholdsByRef.get(condition.thresholdRef);
  const dataProblem = checkAmountConditionDataProblem(order, threshold);
  if (dataProblem !== null) {
    return { matches: false, dataProblem };
  }
  if (threshold === undefined) {
    return { matches: false, dataProblem: null };
  }
  const matches =
    condition.op === 'gte' ? order.totalGross >= threshold.amount : order.totalGross < threshold.amount;
  return { matches, dataProblem: null };
}

/** Tiers 1 + 2 for ONE scope (a real country, or `★ Rest of world`). */
function evaluateScope(
  rules: readonly SalesDocumentRuleFact[],
  defaults: readonly SalesDocumentCountryDefaultFact[],
  order: SalesDocumentOrderFacts,
  now: Date,
  thresholdsByRef: ReadonlyMap<string, SalesDocumentThresholdFact>,
): ScopeResult {
  const matched: SalesDocumentRuleFact[] = [];
  // The first order-data problem encountered across ALL rules in this scope,
  // kept aside rather than returned immediately (review finding 3): a rule
  // ordered AFTER a clean match must never discard that match just because
  // IT happens to reference a threshold with a currency mismatch, or the
  // order is net-priced. The problem is only surfaced if the scope ends up
  // with no clean match at all — see below.
  let dataProblemFound: 'net-priced' | 'currency-mismatch' | null = null;
  for (const rule of rules) {
    if (!isEffective(rule, now)) continue;

    let allTrue = true;
    for (const condition of rule.conditions) {
      const { matches, dataProblem } = evaluateCondition(condition, order, thresholdsByRef);
      if (dataProblem !== null) {
        // This rule cannot be reliably evaluated — it does not match, but
        // the problem is remembered in case nothing else in the scope does
        // either.
        dataProblemFound ??= dataProblem;
        allTrue = false;
        break;
      }
      if (!matches) {
        allTrue = false;
        break;
      }
    }
    if (allTrue) matched.push(rule);
  }

  if (matched.length === 1) {
    return {
      kind: 'route',
      documentKind: matched[0].documentKind,
      connectionId: matched[0].connectionId,
    };
  }
  if (matched.length > 1) {
    return { kind: 'ambiguous-rules' };
  }
  if (dataProblemFound !== null) {
    return { kind: dataProblemFound };
  }

  // Tier 2: the scope's own default, but only when exactly one documentKind
  // has one configured. Two simultaneously-configured defaults (one per
  // kind) with no rule to discriminate between them is a genuine ambiguity
  // this mechanism does not silently resolve — reusing the existing
  // "several candidates, no primary" reason rather than inventing a new one,
  // since the shape is the same: N candidates, no discriminator.
  if (defaults.length === 1) {
    return { kind: 'route', documentKind: defaults[0].documentKind, connectionId: defaults[0].connectionId };
  }
  if (defaults.length > 1) {
    return { kind: 'ambiguous-defaults' };
  }
  return { kind: 'no-match' };
}

/**
 * Resolve the sales-document routing decision for one order via the
 * country-agnostic rule engine. See the module doc comment for the full
 * four-tier ladder and the reasoning behind each `unresolved` mapping.
 */
export function evaluateSalesDocumentRules(input: SalesDocumentRuleEngineInput): SalesDocumentDecision {
  const { order, countryRules, countryDefaults, restOfWorldRules, restOfWorldDefaults, thresholds, now } =
    input;
  const thresholdsByRef = new Map(thresholds.map((t) => [t.ref, t] as const));

  const countryConfigured = countryRules.length > 0 || countryDefaults.length > 0;
  const countryResult = evaluateScope(countryRules, countryDefaults, order, now, thresholdsByRef);

  if (countryResult.kind === 'route') {
    return {
      kind: 'route',
      documentKind: countryResult.documentKind,
      connectionId: countryResult.connectionId,
    };
  }
  if (countryResult.kind === 'net-priced') {
    return { kind: 'unresolved', reason: 'net-priced-order' };
  }
  if (countryResult.kind === 'currency-mismatch') {
    return { kind: 'unresolved', reason: 'threshold-currency-mismatch' };
  }
  if (countryResult.kind === 'ambiguous-rules') {
    return { kind: 'unresolved', reason: 'conflicting-rules-equal-priority' };
  }

  if (countryConfigured) {
    // Tier 3 does NOT apply — the country carries SOME configuration, it
    // simply didn't resolve. Falling through to `★ Rest of world` here would
    // silently override what the operator DID configure for this country.
    if (countryResult.kind === 'ambiguous-defaults') {
      return { kind: 'unresolved', reason: 'ambiguous-connection-no-primary' };
    }
    return { kind: 'unresolved', reason: 'no-matching-rule' };
  }

  // Tier 3: the country carried NOTHING at all — evaluate `★ Rest of world`
  // by the identical ladder.
  const rowConfigured = restOfWorldRules.length > 0 || restOfWorldDefaults.length > 0;
  const rowResult = evaluateScope(restOfWorldRules, restOfWorldDefaults, order, now, thresholdsByRef);

  if (rowResult.kind === 'route') {
    return { kind: 'route', documentKind: rowResult.documentKind, connectionId: rowResult.connectionId };
  }
  if (rowResult.kind === 'net-priced') {
    return { kind: 'unresolved', reason: 'net-priced-order' };
  }
  if (rowResult.kind === 'currency-mismatch') {
    return { kind: 'unresolved', reason: 'threshold-currency-mismatch' };
  }
  if (rowResult.kind === 'ambiguous-rules') {
    return { kind: 'unresolved', reason: 'conflicting-rules-equal-priority' };
  }
  if (rowConfigured) {
    if (rowResult.kind === 'ambiguous-defaults') {
      return { kind: 'unresolved', reason: 'ambiguous-connection-no-primary' };
    }
    return { kind: 'unresolved', reason: 'no-matching-rule' };
  }

  // Tier 4: neither the order's own country nor `★ Rest of world` carries any
  // configuration at all.
  return { kind: 'unresolved', reason: 'no-configuration-for-country' };
}

// Re-exported for callers that only need the scoping constant, mirroring the
// pattern `readSalesDocumentRouting` already establishes for this concern.
export { SALES_DOCUMENT_REST_OF_WORLD_COUNTRY };
