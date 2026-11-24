/**
 * Delivery Rider Action
 *
 * Fix-it deep-link buttons for the order-detail delivery rider (#1794, epic
 * #1776). Rendered into the `actionSlot` of #1793's `DeliveryRiderBanner`,
 * replacing the disabled "Coming soon" placeholder with a real navigation:
 *
 * - `unmapped` → **Add mapping**: opens the routing editor for the source
 *   connection in a dialog (#3958). The rider promises OpenLinker will generate
 *   the label, which only a fulfilment routing rule does; the Delivery
 *   (carriers) tab it used to link to maps a shop carrier and never buys one.
 * - `not-connected` → **Connect {carrier}**: the candidate carrier's guided
 *   new-connection wizard (or the platform picker when it ships no wizard).
 * - `disabled` → **Enable {carrier}** (#1799): the connections list, where the
 *   operator re-enables the disabled carrier connection.
 *
 * @module apps/web/src/features/orders/components
 */
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { useMessages } from '../../../shared/i18n';
import { usePlatform } from '../../../shared/plugins';
import type { OrderDeliveryRider } from '../api/orders.types';
import { ShippingRouteAction } from './shipping-route-action';
import { deliveryRiderActionLabel } from './delivery-chip';

interface DeliveryRiderActionProps {
  rider: OrderDeliveryRider;
  /** Source connection whose routing the Add-mapping dialog edits. */
  sourceConnectionId: string;
  /** Unmapped source delivery-method id; names the method when no label is known. */
  sourceDeliveryMethodId?: string | null;
  /** Source delivery-method label, named in the dialog. */
  sourceDeliveryMethodName?: string | null;
}

export function DeliveryRiderAction({
  rider,
  sourceConnectionId,
  sourceDeliveryMethodId,
  sourceDeliveryMethodName,
}: DeliveryRiderActionProps): ReactElement | null {
  const copy = useMessages('orders').deliveryChip.action;
  const candidate = rider.candidateCarrier;
  const carrier = candidate?.displayName ?? null;
  // Resolved unconditionally (never inside a branch) so hook order stays stable.
  // The candidate carrier's guided setup wizard; falls back to the platform
  // picker when the plugin ships no setup card.
  const connectTarget = usePlatform(candidate?.platformType)?.setupCard?.to ?? '/connections/new';

  if (rider.rider === 'unmapped') {
    return (
      <ShippingRouteAction
        sourceConnectionId={sourceConnectionId}
        methodLabel={sourceDeliveryMethodName ?? sourceDeliveryMethodId}
        methodId={sourceDeliveryMethodId}
        label={deliveryRiderActionLabel('unmapped', carrier, copy)}
        appearance="rider"
      />
    );
  }

  if (rider.rider === 'not-connected') {
    const label = deliveryRiderActionLabel('not-connected', carrier, copy);
    return (
      <Link to={connectTarget} className="delivery-rider-banner__button">
        {label}
      </Link>
    );
  }

  if (rider.rider === 'disabled') {
    // The carrier connection exists but is disabled - send the operator to the
    // connections list pre-filtered to the disabled carrier so they can find and
    // re-enable it. The connections list reads `platformType` + `status` from
    // the query string; when the heuristic couldn't name the carrier we fall
    // back to the unfiltered list.
    const label = deliveryRiderActionLabel('disabled', carrier, copy);
    const to = candidate
      ? `/connections?platformType=${encodeURIComponent(candidate.platformType)}&status=disabled`
      : '/connections';
    return (
      <Link to={to} className="delivery-rider-banner__button">
        {label}
      </Link>
    );
  }

  return null;
}
