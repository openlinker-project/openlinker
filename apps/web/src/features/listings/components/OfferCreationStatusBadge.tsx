/**
 * OfferCreationStatusBadge
 *
 * Maps an `OfferCreationStatus` to the shared `StatusBadge` primitive.
 * Keeps the colour mapping in one place so every surface (tracker,
 * future detail page, future "Recent creations" view) stays consistent.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { OfferCreationStatus } from '../api/listings.types';

const STATUS_TONE: Record<OfferCreationStatus, StatusBadgeTone> = {
  pending: 'info',
  draft: 'review',
  validating: 'warning',
  active: 'success',
  reused: 'success',
  failed: 'error',
};

const STATUS_LABEL: Record<OfferCreationStatus, string> = {
  pending: 'Pending',
  draft: 'Draft',
  validating: 'Validating',
  active: 'Active',
  reused: 'Already existed',
  failed: 'Failed',
};

interface OfferCreationStatusBadgeProps {
  status: OfferCreationStatus;
  compact?: boolean;
}

export function OfferCreationStatusBadge({
  status,
  compact = false,
}: OfferCreationStatusBadgeProps): ReactElement {
  return (
    <StatusBadge tone={STATUS_TONE[status]} compact={compact} withDot>
      {STATUS_LABEL[status]}
    </StatusBadge>
  );
}
