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
  submitted: 'info',
  cleared: 'success',
  accepted: 'success',
  rejected: 'error',
};

const LABEL_FALLBACK: Record<RegulatoryStatus, string> = {
  'not-applicable': 'N/A',
  submitted: 'KSeF: submitted',
  cleared: 'KSeF: cleared',
  accepted: 'KSeF: accepted',
  rejected: 'KSeF: rejected',
};

interface RegulatoryStatusBadgeProps {
  status: RegulatoryStatus;
}

export function RegulatoryStatusBadge({ status }: RegulatoryStatusBadgeProps): ReactElement {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={TONE[status]} withDot pulse={status === 'submitted'}>
      {t(`invoice.regulatory.${status}`, LABEL_FALLBACK[status])}
    </StatusBadge>
  );
}
