/**
 * Fiscal receipt display derivation (#1909)
 *
 * Pure helpers turning a `FiscalRegistrationRecord | null` into the FE display
 * status and the operator-facing failure copy. Mirrors
 * `derive-invoice-display.ts` — same shape, distinct union, deliberately not
 * shared (ADR-042 dec. 7: fiscalization's failure taxonomy is its own).
 *
 * @module apps/web/src/features/fiscalization/lib
 */
import type { FiscalRegistrationRecord } from '../api/fiscalization.types';
import type { FiscalReceiptDisplayStatus } from '../components/fiscal-receipt-status-badge';

export function deriveFiscalReceiptDisplayStatus(
  record: FiscalRegistrationRecord | null,
): FiscalReceiptDisplayStatus {
  if (!record) {
    return 'not-registered';
  }
  if (record.status !== 'failed') {
    return record.status;
  }
  // A failed record with failureMode `'rejected'` is a plain, retryable
  // failure; anything else (including a null/unknown mode) is in-doubt — never
  // auto-retried, resolved only by a provider lookup or an operator decision.
  return record.failureMode === 'rejected' ? 'rejected' : 'in-doubt';
}

/** `rejected` is the ONLY failure mode where the provider definitely created
 *  nothing, so it is the only one a plain retry may act on. */
export function canRetryFiscalReceipt(record: FiscalRegistrationRecord): boolean {
  return record.status === 'failed' && record.failureMode === 'rejected';
}

export function resolveFiscalFailureCopy(
  record: FiscalRegistrationRecord,
  t: (key: string, fallback: string) => string,
): string {
  if (record.failureReason && record.failureReason.trim().length > 0) {
    return record.failureReason;
  }
  return record.failureMode === 'rejected'
    ? t(
        'fiscalReceipt.failed.genericRejected',
        'The provider rejected this sale. Nothing was registered, so it is safe to try again once the cause is fixed.',
      )
    : t(
        'fiscalReceipt.failed.genericInDoubt',
        'The connection dropped before we learned the outcome. This sale may already be registered.',
      );
}
