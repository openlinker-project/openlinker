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

/** FE display state: the backend statuses plus the invoice-absent state, plus
 *  the `in-doubt` variant derived from a `failed` row's `failureMode` (rendered
 *  as a distinct "Needs review" badge so an operator never reads an unconfirmed
 *  outcome as a plain failure). The host derives `in-doubt` from
 *  `status === 'failed' && failureMode !== 'rejected'`. */
export type InvoiceDisplayStatus = InvoiceStatus | 'not-issued' | 'in-doubt';

const TONE: Record<InvoiceDisplayStatus, StatusBadgeTone> = {
  'not-issued': 'neutral',
  pending: 'warning',
  issuing: 'info',
  issued: 'success',
  failed: 'error',
  'in-doubt': 'warning',
};

const LABEL_FALLBACK: Record<InvoiceDisplayStatus, string> = {
  'not-issued': 'Not issued',
  pending: 'Pending',
  issuing: 'Issuing…',
  issued: 'Issued',
  failed: 'Failed',
  'in-doubt': 'Needs review',
};

/** Statuses that pulse the leading dot — genuinely in-flight states only
 *  (pending awaiting clearance, issuing holding a live lease). */
const PULSE: ReadonlySet<InvoiceDisplayStatus> = new Set(['pending', 'issuing']);

interface InvoiceStatusBadgeProps {
  status: InvoiceDisplayStatus;
}

export function InvoiceStatusBadge({ status }: InvoiceStatusBadgeProps): ReactElement {
  const { t } = useTranslation();
  return (
    <StatusBadge tone={TONE[status]} withDot pulse={PULSE.has(status)}>
      {t(`invoice.status.${status}`, LABEL_FALLBACK[status])}
    </StatusBadge>
  );
}
