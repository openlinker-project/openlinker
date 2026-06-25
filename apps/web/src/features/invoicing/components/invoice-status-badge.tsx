/**
 * Invoice Status Badge (#757)
 *
 * Maps `InvoiceStatus` plus the FE-only derived `not-issued` state to a
 * `StatusBadge` tone + a `t()`-labelled word. Mirrors `ShipmentStatusBadge`.
 *
 * @module apps/web/src/features/invoicing/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import { useTranslation } from '../../../shared/i18n';
import type { InvoiceStatus } from '../api/invoicing.types';

/** FE display state: the backend statuses plus the invoice-absent state. */
export type InvoiceDisplayStatus = InvoiceStatus | 'not-issued';

const TONE: Record<InvoiceDisplayStatus, StatusBadgeTone> = {
  'not-issued': 'neutral',
  pending: 'warning',
  issued: 'success',
  failed: 'error',
};

const LABEL_FALLBACK: Record<InvoiceDisplayStatus, string> = {
  'not-issued': 'Not issued',
  pending: 'Pending',
  issued: 'Issued',
  failed: 'Failed',
};

interface InvoiceStatusBadgeProps {
  status: InvoiceDisplayStatus;
}

export function InvoiceStatusBadge({ status }: InvoiceStatusBadgeProps): ReactElement {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={TONE[status]} withDot pulse={status === 'pending'}>
      {t(`invoice.status.${status}`, LABEL_FALLBACK[status])}
    </StatusBadge>
  );
}
