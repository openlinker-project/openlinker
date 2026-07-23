/**
 * Delivery Rider Action
 *
 * Fix-it deep-link buttons for the order-detail delivery rider (#1794, epic
 * #1776). Rendered into the `actionSlot` of #1793's `DeliveryRiderBanner`,
 * replacing the disabled "Coming soon" placeholder with a real navigation:
 *
 * - `unmapped` → **Add mapping**: the source connection's Delivery (carriers)
 *   mapping tab, pre-focused on the unmapped source method.
 * - `not-connected` → **Connect {carrier}**: the candidate carrier's guided
 *   new-connection wizard (or the platform picker when it ships no wizard).
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { usePlatform } from '../../../shared/plugins';
import { buildDeliveryMappingLink } from '../../mappings';
import type { OrderDeliveryRider } from '../api/orders.types';

interface DeliveryRiderActionProps {
  rider: OrderDeliveryRider;
  /** Source connection whose Delivery mapping tab the Add-mapping link targets. */
  sourceConnectionId: string;
  /** Unmapped source delivery-method id (Add-mapping pre-focus target). */
  sourceDeliveryMethodId?: string | null;
  /** Source delivery-method label (fallback pre-focus copy). */
  sourceDeliveryMethodName?: string | null;
}

export function DeliveryRiderAction({
  rider,
  sourceConnectionId,
  sourceDeliveryMethodId,
  sourceDeliveryMethodName,
}: DeliveryRiderActionProps): ReactElement | null {
  const candidate = rider.candidateCarrier;
  // Resolved unconditionally (never inside a branch) so hook order stays stable.
  // The candidate carrier's guided setup wizard; falls back to the platform
  // picker when the plugin ships no setup card.
  const connectTarget = usePlatform(candidate?.platformType)?.setupCard?.to ?? '/connections/new';

  if (rider.rider === 'unmapped') {
    const to = buildDeliveryMappingLink({
      connectionId: sourceConnectionId,
      sourceDeliveryMethodId,
      sourceDeliveryMethodName,
    });
    return (
      <Link to={to} className="delivery-rider-banner__button">
        Add mapping
      </Link>
    );
  }

  if (rider.rider === 'not-connected') {
    const label = candidate ? `Connect ${candidate.displayName}` : 'Connect';
    return (
      <Link to={connectTarget} className="delivery-rider-banner__button">
        {label}
      </Link>
    );
  }

  return null;
}
