/**
 * Fiscal Receipt Status Badge (#1909)
 *
 * Maps the FE display status to a `StatusBadge` tone + label. Mirrors
 * `InvoiceStatusBadge`, with the same `in-doubt` derivation: a `failed` record
 * whose `failureMode` is anything other than `'rejected'` renders as a distinct
 * "Needs review" badge, never as a plain failure — `in-doubt` is never
 * auto-retried and must never look like an ordinary error (ADR-042 dec. 7).
 *
 * @module apps/web/src/features/fiscalization/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useTranslation } from '../../../shared/i18n';

export type FiscalReceiptDisplayStatus =
  | 'not-registered'
  | 'pending'
  | 'registering'
  | 'registered'
  | 'rejected'
  | 'in-doubt';

const TONE: Record<FiscalReceiptDisplayStatus, StatusBadgeTone> = {
  'not-registered': 'neutral',
  pending: 'info',
  registering: 'info',
  registered: 'success',
  rejected: 'error',
  'in-doubt': 'warning',
};

const LABEL_FALLBACK: Record<FiscalReceiptDisplayStatus, string> = {
  'not-registered': 'Not registered',
  // `pending` means the request was never actually sent (the row exists but no
  // claim was ever taken - see I6) - distinct from `registering`, a live
  // in-flight attempt. Sharing one label told the operator something was
  // happening when nothing was.
  pending: 'Queued',
  registering: 'Registering',
  registered: 'Registered',
  rejected: 'Rejected',
  'in-doubt': 'Unconfirmed',
};

// `pending` is not pulsed: it is an actionable, static state (a "Register
// receipt" button is offered), not something to wait out.
const PULSE: ReadonlySet<FiscalReceiptDisplayStatus> = new Set(['registering', 'in-doubt']);

interface FiscalReceiptStatusBadgeProps {
  status: FiscalReceiptDisplayStatus;
}

export function FiscalReceiptStatusBadge({
  status,
}: FiscalReceiptStatusBadgeProps): ReactElement {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={TONE[status]} withDot pulse={PULSE.has(status)}>
      {t(`fiscalReceipt.status.${status}`, LABEL_FALLBACK[status])}
    </StatusBadge>
  );
}
