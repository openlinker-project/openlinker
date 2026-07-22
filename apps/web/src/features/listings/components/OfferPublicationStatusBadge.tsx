/**
 * OfferPublicationStatusBadge
 *
 * Maps a live `OfferPublicationStatus` (#1760) to the shared `StatusBadge`
 * primitive. Distinct from `OfferCreationStatusBadge` (the one-shot creation
 * lifecycle) — this is the steady-state marketplace publication status read
 * from `offer_status_snapshots`. Kept in one place so every surface renders
 * the same vocabulary.
 *
 * @module apps/web/src/features/listings/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { OfferPublicationStatus } from '../api/listings.types';

const STATUS_TONE: Record<OfferPublicationStatus, StatusBadgeTone> = {
  active: 'success',
  activating: 'warning',
  inactivating: 'warning',
  inactive: 'review',
  ended: 'neutral',
};

const STATUS_LABEL: Record<OfferPublicationStatus, string> = {
  active: 'Active',
  activating: 'Activating',
  inactivating: 'Deactivating',
  inactive: 'Inactive',
  ended: 'Ended',
};

/** Transient async states pulse the dot to read as "in flight". */
const PULSING_STATUSES: ReadonlySet<OfferPublicationStatus> = new Set([
  'activating',
  'inactivating',
]);

interface OfferPublicationStatusBadgeProps {
  status: OfferPublicationStatus;
  compact?: boolean;
}

export function OfferPublicationStatusBadge({
  status,
  compact = false,
}: OfferPublicationStatusBadgeProps): ReactElement {
  return (
    <StatusBadge
      tone={STATUS_TONE[status]}
      compact={compact}
      withDot
      pulse={PULSING_STATUSES.has(status)}
    >
      {STATUS_LABEL[status]}
    </StatusBadge>
  );
}
