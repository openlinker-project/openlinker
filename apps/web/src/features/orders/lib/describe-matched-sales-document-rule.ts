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
  // orderTotalGross — the threshold's own amount/currency is not part of this
  // projection (it lives in `sales_document_thresholds`, versioned separately
  // per ADR-041 decision 5), so the comparison is named generically rather
  // than resolved through a second query this disclosure does not otherwise
  // need.
  return condition.op === 'gte'
    ? t('salesDocument.matchedRule.totalAtLeast', 'total at or above the configured threshold')
    : t('salesDocument.matchedRule.totalUnder', 'total under the configured threshold');
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
