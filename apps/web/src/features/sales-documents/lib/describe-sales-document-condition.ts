/**
 * Describe Sales-Document Condition (#2170)
 *
 * Pure, presentation-only rendering of one condition into operator-facing
 * text. Rendered in the operator's own vocabulary at THIS layer only — the
 * underlying `field` stays a closed, cross-country string
 * (`buyerHasTaxId`, never `buyerHasNip`); a German rule would read the SAME
 * field, this function is simply the one place that could later branch on
 * locale to say "VAT ID" instead of "tax ID".
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentConditionInput } from '../api/sales-document-rules.types';

export function describeSalesDocumentCondition(condition: SalesDocumentConditionInput): string {
  if (condition.field === 'buyerHasTaxId') {
    return condition.boolValue ? 'customer has a tax ID' : 'customer has no tax ID';
  }
  if (condition.field === 'orderCountry') {
    return `order country is ${condition.stringValue ?? '?'}`;
  }
  const comparison = condition.op === 'gte' ? '≥' : '<';
  return `total ${comparison} ${condition.thresholdRef ?? '?'}`;
}
