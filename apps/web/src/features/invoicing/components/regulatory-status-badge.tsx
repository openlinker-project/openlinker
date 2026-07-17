/**
 * Regulatory (KSeF) Status Badge (#757)
 *
 * Maps a `RegulatoryStatus` to a `StatusBadge` tone + `t()` label. Rendered
 * ONLY by the panel's `regulatoryStatus !== 'not-applicable'` gate (plan §1.6),
 * so `not-applicable` never reaches here.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useTranslation } from '../../../shared/i18n';
import type { RegulatoryStatus } from '../api/invoicing.types';

const TONE: Record<RegulatoryStatus, StatusBadgeTone> = {
  'not-applicable': 'neutral',
  // Offline degraded-mode window (#1585): ISSUED but NOT yet transmitted. Amber
  // `warning` — a sweep is resubmitting (no operator action owed), but it is NOT
  // a submission/clearance success and must never read as one.
  'pending-submission': 'warning',
  submitted: 'info',
  // `cleared` is a reserved split-clearance status no current provider emits;
  // terminal regulatory success is `accepted`. Never render `cleared` as
  // `success` — keep it a non-terminal `info` so an unconfirmed clearance can
  // never read as done (matches the constraint documented in invoicing.types.ts).
  cleared: 'info',
  accepted: 'success',
  rejected: 'error',
};

/**
 * English fallback labels for each `RegulatoryStatus`. Exported so the invoices
 * list-page filter reuses the SAME labels the badge renders (#1585 F7) instead of
 * falling back to the raw hyphenated enum slug (`pending-submission`).
 */
export const REGULATORY_STATUS_LABEL_FALLBACK: Record<RegulatoryStatus, string> = {
  'not-applicable': 'N/A',
  'pending-submission': 'KSeF: awaiting submission',
  submitted: 'KSeF: submitted',
  cleared: 'KSeF: clearing',
  accepted: 'KSeF: accepted',
  rejected: 'KSeF: rejected',
};

const LABEL_FALLBACK = REGULATORY_STATUS_LABEL_FALLBACK;

interface RegulatoryStatusBadgeProps {
  status: RegulatoryStatus;
}

export function RegulatoryStatusBadge({ status }: RegulatoryStatusBadgeProps): ReactElement {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={TONE[status]}
      withDot
      pulse={status === 'submitted' || status === 'pending-submission'}
    >
      {t(`invoice.regulatory.${status}`, LABEL_FALLBACK[status])}
    </StatusBadge>
  );
}
