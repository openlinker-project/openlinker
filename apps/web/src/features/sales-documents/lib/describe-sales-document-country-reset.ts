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
export interface SalesDocumentCountryResetSummary {
  ruleCount: number;
  hasInvoiceDefault: boolean;
  hasReceiptDefault: boolean;
  acknowledged: boolean;
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return 'nothing';
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(', ')}, and ${clauses[clauses.length - 1]}`;
}

export function describeSalesDocumentCountryReset(
  displayName: string,
  summary: SalesDocumentCountryResetSummary,
): string {
  const clauses: string[] = [];

  if (summary.ruleCount > 0) {
    clauses.push(pluralize(summary.ruleCount, 'rule'));
  }
  if (summary.hasInvoiceDefault && summary.hasReceiptDefault) {
    clauses.push('both country defaults');
  } else if (summary.hasInvoiceDefault) {
    clauses.push('the Invoice default');
  } else if (summary.hasReceiptDefault) {
    clauses.push('the Receipt default');
  }
  if (summary.acknowledged) {
    clauses.push('the no-document acknowledgment');
  }

  return `This deletes ${joinClauses(clauses)} for ${displayName}. This can't be undone.`;
}
