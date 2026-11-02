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
import type { FiscalProviderFailureDetails } from '../api/fiscalization.types';

export interface FiscalFailureDetailRow {
  key: 'errorCode' | 'deviceErrorCode' | 'documentId';
  label: string;
  value: string;
}

/** Rows for the identifiers the provider declared, in a fixed order. */
export function buildFiscalFailureDetailRows(
  details: FiscalProviderFailureDetails | null,
  t: (key: string, fallback: string) => string,
): FiscalFailureDetailRow[] {
  if (!details) return [];
  const rows: FiscalFailureDetailRow[] = [];
  if (details.errorCode) {
    rows.push({
      key: 'errorCode',
      label: t('fiscalReceipt.details.errorCode', 'Provider error code'),
      value: details.errorCode,
    });
  }
  if (details.deviceErrorCode) {
    rows.push({
      key: 'deviceErrorCode',
      label: t('fiscalReceipt.details.deviceErrorCode', 'Printer error code'),
      value: details.deviceErrorCode,
    });
  }
  if (details.documentId) {
    rows.push({
      key: 'documentId',
      label: t('fiscalReceipt.details.documentId', 'Provider document ID'),
      value: details.documentId,
    });
  }
  return rows;
}

/** One `label: value` line per row, ready to paste into a support ticket. */
export function buildFiscalFailureSupportText(rows: readonly FiscalFailureDetailRow[]): string {
  return rows.map((row) => `${row.label}: ${row.value}`).join('\n');
}
