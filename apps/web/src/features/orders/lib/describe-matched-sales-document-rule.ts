/**
 * Describe a matched sales-document rule (#3186)
 *
 * Composes the "Why this kind?" disclosure's sentence from the raw rule data
 * the backend projects onto `SalesDocumentView.matchedRule` - country,
 * conditions, document kind, connection id. Country-agnostic by construction:
 * `rule.country` is echoed back verbatim (whatever the operator configured),
 * never a hardcoded regulator/region literal, matching the same discipline
 * `libs/core/src/sales-documents` enforces with a build-failing vocabulary
 * sweep. This module names no country, regime, or provider by itself.
 *
 * @module apps/web/src/features/orders/lib
 */
import { interpolate, type Messages, type ResolvedCopy } from '../../../shared/i18n';
import type {
  SalesDocumentMatchedRuleCondition,
  SalesDocumentMatchedRuleView,
} from '../api/orders.types';

/** The disclosure's words, from the `orders` namespace. */
export type MatchedRuleCopy = ResolvedCopy<Messages['orders']>['matchedSalesDocumentRule'];

/** Whether the matched rule's conditions include `buyerHasTaxId` (#3186 AC). */
export function matchedRuleReadsBuyerTaxId(
  rule: Pick<SalesDocumentMatchedRuleView, 'conditions'>,
): boolean {
  return rule.conditions.some((condition) => condition.field === 'buyerHasTaxId');
}

function describeCondition(condition: SalesDocumentMatchedRuleCondition, copy: MatchedRuleCopy): string {
  // Captured before the narrowing below so the fallback can still echo it. This
  // union is a HAND-WRITTEN mirror of `SalesDocumentConditionFieldValues` in
  // `libs/core` - the browser bundle does not depend on `@openlinker/core`
  // (#591), so the vocabulary is re-declared here rather than imported. Drift is
  // a BUILD failure now: `scripts/check-sales-document-condition-field-mirror.mjs`
  // (under `pnpm check:invariants`) compares the two, so a fourth field added in
  // core can no longer reach this function while the type here still says three.
  // The echo arm below stays regardless - that guard aligns the two SOURCE
  // trees, it cannot stop a deployed API running ahead of this bundle from
  // sending a value neither side knows about yet.
  const field: string = condition.field;

  if (condition.field === 'buyerHasTaxId') {
    return condition.boolValue ? copy.hasTaxId : copy.noTaxId;
  }
  if (condition.field === 'orderCountry') {
    return interpolate(copy.shipsTo, { country: condition.stringValue ?? '?' });
  }
  if (condition.field === 'orderTotalGross') {
    // #3189 put the amount and currency ON the condition, so the sentence names
    // the figure the operator typed instead of the versioned threshold slug it
    // used to gesture at. A condition carrying no amount is a rule this build
    // cannot read: it keeps the generic wording rather than printing a figure
    // that was never asserted.
    const amount = condition.amount;
    if (amount === undefined) {
      return condition.op === 'gte' ? copy.totalAtLeast : copy.totalUnder;
    }
    const figure = condition.currency
      ? interpolate(copy.amountWithCurrency, { amount, currency: condition.currency })
      : amount;
    return interpolate(condition.op === 'gte' ? copy.totalAtLeastAmount : copy.totalUnderAmount, {
      amount: figure,
    });
  }

  // Tested explicitly rather than left as the fall-through arm (#3186 review):
  // an unrecognised field rendered as "total under the configured threshold"
  // is a confident FALSE statement about the operator's own rule - the exact
  // failure `#2240`'s `unknown-category-result` records. Echo the raw field,
  // the same honesty `describeDocumentKind` below already applies to an
  // open-world kind, so the value survives into a support ticket.
  return field;
}

/** Plain-language label for an open-world document kind. */
function describeDocumentKind(kind: string, copy: MatchedRuleCopy): string {
  if (kind === 'invoice') return copy.kind.invoice;
  if (kind === 'fiscal-receipt') return copy.kind.receipt;
  return kind;
}

/**
 * "Matched the {market} rule ({conditions}), which registers a {kind} through
 * {connection}." - the sentence the "Why this kind?" disclosure renders,
 * verbatim, in `data-testid="sales-document-matched-rule"`.
 */
export function describeMatchedSalesDocumentRule(
  rule: SalesDocumentMatchedRuleView,
  connectionName: string,
  copy: MatchedRuleCopy,
): string {
  const market = rule.country === '*' ? copy.restOfWorld : rule.country;
  const conditions = rule.conditions
    .map((condition) => describeCondition(condition, copy))
    .join(' · ');
  const kind = describeDocumentKind(rule.documentKind, copy);

  return interpolate(copy.sentence, { market, conditions, kind, connection: connectionName });
}
