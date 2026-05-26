/**
 * Shipment Status Badge
 *
 * Renders a semantic status badge for a shipment, mapping the lifecycle status
 * to a `StatusBadge` tone. Mirrors `SyncJobStatusBadge`. In-flight states
 * (`dispatched` / `in-transit`) pulse the dot; the label stays the literal
 * status word so colour is never the only signal.
 *
 * @module apps/web/src/features/shipments/components
 */
import type { ReactElement } from 'react';
import { StatusBadge, type StatusBadgeTone } from '../../../shared/ui/status-badge';
import type { ShipmentStatus } from '../api/shipments.types';

const TONE: Record<ShipmentStatus, StatusBadgeTone> = {
  draft: 'review',
  generated: 'info',
  dispatched: 'info',
  'in-transit': 'info',
  delivered: 'success',
  failed: 'error',
  cancelled: 'neutral',
};

const PULSE: ReadonlySet<ShipmentStatus> = new Set<ShipmentStatus>(['dispatched', 'in-transit']);

interface ShipmentStatusBadgeProps {
  status: ShipmentStatus;
}

export function ShipmentStatusBadge({ status }: ShipmentStatusBadgeProps): ReactElement {
  return (
    <StatusBadge tone={TONE[status] ?? 'neutral'} withDot pulse={PULSE.has(status)}>
      {status}
    </StatusBadge>
  );
}
