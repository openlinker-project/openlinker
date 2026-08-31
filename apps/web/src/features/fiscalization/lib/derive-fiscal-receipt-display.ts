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
import type {
  FiscalRegistrationProgress,
  FiscalRegistrationRecord,
} from '../api/fiscalization.types';
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

/**
 * The badge status for a receipt whose progress is known (#2527).
 *
 * The record alone cannot answer this. For the whole window between a request
 * being accepted and the job running there is NO record, and
 * {@link deriveFiscalReceiptDisplayStatus} answers `not-registered` for a null
 * one - so the panel's header read "Not registered" while its body said a
 * registration was in flight. Two states in the same slot contradicting each
 * other, on the surface the operator reads fastest.
 *
 * Progress wins for the four states the record cannot express, and only those:
 *
 *   - `queued` -> `pending`, the badge that already means accepted and waiting;
 *   - `running` -> `registering`;
 *   - `stalled` -> `not-registered`. Nothing is running AND nothing reached the
 *     provider, so the neutral badge is literally true. `pending` would say the
 *     work is waiting its turn when nothing will pick it up;
 *   - `interrupted` -> `in-doubt` ("Unconfirmed"). An attempt stopped without
 *     answering, so whether the sale is registered is unknown - which is what
 *     that badge means. `registering` would claim an attempt is running.
 *
 * Every other progress value describes a state the record already carries
 * (registered, rejected, in-doubt) or carries nothing to show, so those fall
 * back to the record and the two cannot disagree.
 */
export function deriveFiscalReceiptBadgeStatus(
  record: FiscalRegistrationRecord | null,
  progress: FiscalRegistrationProgress | undefined,
): FiscalReceiptDisplayStatus {
  switch (progress) {
    case 'queued':
      return 'pending';
    case 'running':
      return 'registering';
    case 'stalled':
      return 'not-registered';
    case 'interrupted':
      return 'in-doubt';
    default:
      return deriveFiscalReceiptDisplayStatus(record);
  }
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
