/**
 * Describe Sales-Document Country Reset (#2189)
 *
 * Pure, presentation-only rendering of the "Reset country" confirm-dialog
 * description — naming EXACTLY what will be deleted (rule count, either or
 * both country defaults, the no-document acknowledgment) rather than a
 * generic "this deletes everything" sentence, since the operator is about to
 * make an irreversible choice.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import { formatPlural, getBcp47Locale, getLocale, getMessages, interpolate } from '../../../shared/i18n';

export interface SalesDocumentCountryResetSummary {
  ruleCount: number;
  hasInvoiceDefault: boolean;
  hasReceiptDefault: boolean;
  acknowledged: boolean;
}


function joinClauses(clauses: string[], nothing: string): string {
  if (clauses.length === 0) return nothing;
  return new Intl.ListFormat(getBcp47Locale(getLocale()), { type: 'conjunction' }).format(clauses);
}

export function describeSalesDocumentCountryReset(
  displayName: string,
  summary: SalesDocumentCountryResetSummary,
): string {
  const copy = getMessages('sales-documents').countryReset;
  const clauses: string[] = [];

  if (summary.ruleCount > 0) {
    clauses.push(formatPlural(summary.ruleCount, copy.rules, getLocale()));
  }
  if (summary.hasInvoiceDefault && summary.hasReceiptDefault) {
    clauses.push(copy.bothDefaults);
  } else if (summary.hasInvoiceDefault) {
    clauses.push(copy.invoiceDefault);
  } else if (summary.hasReceiptDefault) {
    clauses.push(copy.receiptDefault);
  }
  if (summary.acknowledged) {
    clauses.push(copy.acknowledgment);
  }

  return interpolate(copy.sentence, {
    items: joinClauses(clauses, copy.nothing),
    country: displayName,
  });
}
