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
import { getMessages, interpolate } from '../../../shared/i18n';

export function describeSalesDocumentCondition(condition: SalesDocumentConditionInput): string {
  const copy = getMessages('sales-documents').describeCondition;
  if (condition.field === 'buyerHasTaxId') {
    return condition.boolValue ? copy.hasTaxId : copy.noTaxId;
  }
  if (condition.field === 'orderCountry') {
    return interpolate(copy.orderCountry, { country: condition.stringValue ?? '?' });
  }
  // #3189: a real amount and currency, where this used to print the raw
  // `thresholdRef` slug - an internal key the operator never chose and could
  // not read. `?` is kept for a condition this build cannot understand rather
  // than guessing a figure.
  const amount = condition.amount ?? '?';
  const currency = condition.currency ?? '';
  const atLeast = condition.op === 'gte';
  const template = currency
    ? atLeast
      ? copy.totalAtLeastWithCurrency
      : copy.totalBelowWithCurrency
    : atLeast
      ? copy.totalAtLeast
      : copy.totalBelow;
  return interpolate(template, { amount, currency });
}
