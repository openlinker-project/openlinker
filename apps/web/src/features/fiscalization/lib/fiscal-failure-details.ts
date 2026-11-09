/**
 * Fiscal Failure Details - pure helpers (#3843)
 *
 * The rows an operator sees under a failed fiscal receipt, and the plain text
 * "Copy details" puts on the clipboard. One function builds both from the same
 * rows, so what is pasted to the provider's support is exactly what the screen
 * showed.
 *
 * @module features/fiscalization/lib
 */
import { getMessages } from '../../../shared/i18n';
import type { FiscalProviderFailureDetails } from '../api/fiscalization.types';

export interface FiscalFailureDetailRow {
  key: 'errorCode' | 'deviceErrorCode' | 'documentId';
  label: string;
  value: string;
}

/** Rows for the identifiers the provider declared, in a fixed order. */
export function buildFiscalFailureDetailRows(
  details: FiscalProviderFailureDetails | null,
): FiscalFailureDetailRow[] {
  if (!details) return [];
  const copy = getMessages('fiscalization').fiscalReceipt.details;
  const rows: FiscalFailureDetailRow[] = [];
  if (details.errorCode) {
    rows.push({
      key: 'errorCode',
      label: copy.errorCode,
      value: details.errorCode,
    });
  }
  if (details.deviceErrorCode) {
    rows.push({
      key: 'deviceErrorCode',
      label: copy.deviceErrorCode,
      value: details.deviceErrorCode,
    });
  }
  if (details.documentId) {
    rows.push({
      key: 'documentId',
      label: copy.documentId,
      value: details.documentId,
    });
  }
  return rows;
}

/** One `label: value` line per row, ready to paste into a support ticket. */
export function buildFiscalFailureSupportText(rows: readonly FiscalFailureDetailRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join('\n');
}
