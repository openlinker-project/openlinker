/**
 * Describe a matched sales-document rule (#3186)
 *
 * Composes the "Why this kind?" disclosure's sentence from the raw rule data
 * the backend projects onto `SalesDocumentView.matchedRule` — country,
 * conditions, document kind, connection id. Country-agnostic by construction:
 * `rule.country` is echoed back verbatim (whatever the operator configured),
 * never a hardcoded regulator/region literal, matching the same discipline
 * `libs/core/src/sales-documents` enforces with a build-failing vocabulary
 * sweep. This module names no country, regime, or provider by itself.
 *
 * @module apps/web/src/features/orders/lib
 */
import type {
  SalesDocumentMatchedRuleCondition,
  SalesDocumentMatchedRuleView,
} from '../api/orders.types';

type Translate = (key: string, fallback: string) => string;

/** Whether the matched rule's conditions include `buyerHasTaxId` (#3186 AC). */
export function matchedRuleReadsBuyerTaxId(
  rule: Pick<SalesDocumentMatchedRuleView, 'conditions'>,
): boolean {
  return rule.conditions.some((condition) => condition.field === 'buyerHasTaxId');
}

function describeCondition(condition: SalesDocumentMatchedRuleCondition, t: Translate): string {
  // Captured before the narrowing below so the fallback can still echo it: this
  // union is a HAND-WRITTEN mirror of `SalesDocumentConditionFieldValues` in
  // `libs/core`, with no `check-*-mirror.mjs` behind it (unlike the sibling
  // reason vocabulary in this same feature), so a fourth field added in core
  // reaches this function at RUNTIME while the type here still says three.
  const field: string = condition.field;

  if (condition.field === 'buyerHasTaxId') {
    return condition.boolValue
      ? t('salesDocument.matchedRule.hasTaxId', 'has a tax ID')
      : t('salesDocument.matchedRule.noTaxId', 'has no tax ID');
  }
  if (condition.field === 'orderCountry') {
    return t('salesDocument.matchedRule.shipsTo', 'ships to {{country}}').replace(
      '{{country}}',
      condition.stringValue ?? '?',
    );
  }
  if (condition.field === 'orderTotalGross') {
    // The threshold's own amount/currency is not part of this projection (it
    // lives in `sales_document_thresholds`, versioned separately per ADR-041
    // decision 5), so the comparison is named generically rather than resolved
    // through a second query this disclosure does not otherwise need.
    return condition.op === 'gte'
      ? t('salesDocument.matchedRule.totalAtLeast', 'total at or above the configured threshold')
      : t('salesDocument.matchedRule.totalUnder', 'total under the configured threshold');
  }

  // Tested explicitly rather than left as the fall-through arm (#3186 review):
  // an unrecognised field rendered as "total under the configured threshold"
  // is a confident FALSE statement about the operator's own rule — the exact
  // failure `#2240`'s `unknown-category-result` records. Echo the raw field,
  // the same honesty `describeDocumentKind` below already applies to an
  // open-world kind, so the value survives into a support ticket.
  return field;
}

/** Plain-language label for an open-world document kind (mirrors the panel's own `salesDocument.kind.*` keys). */
function describeDocumentKind(kind: string, t: Translate): string {
  if (kind === 'invoice') return t('salesDocument.kind.invoice', 'invoice');
  if (kind === 'fiscal-receipt') return t('salesDocument.kind.receipt', 'fiscal receipt');
  return kind;
}

/**
 * "Matched the {market} rule ({conditions}), which registers a {kind} through
 * {connection}." — the sentence the "Why this kind?" disclosure renders,
 * verbatim, in `data-testid="sales-document-matched-rule"`.
 */
export function describeMatchedSalesDocumentRule(
  rule: SalesDocumentMatchedRuleView,
  connectionName: string,
  t: Translate,
): string {
  const market =
    rule.country === '*'
      ? t('salesDocument.matchedRule.restOfWorld', 'Rest of world')
      : rule.country;
  const conditions = rule.conditions.map((condition) => describeCondition(condition, t)).join(' · ');
  const kind = describeDocumentKind(rule.documentKind, t);

  return t(
    'salesDocument.matchedRule.sentence',
    'Matched the {{market}} rule {{conditions}}, which registers a {{kind}} through {{connection}}.',
  )
    .replace('{{market}}', market)
    .replace('{{conditions}}', conditions)
    .replace('{{kind}}', kind)
    .replace('{{connection}}', connectionName);
}
