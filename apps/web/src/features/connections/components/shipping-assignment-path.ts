/**
 * Link to the shipping assignment (#4135)
 *
 * Who generates labels for each delivery method lives only on the Mappings
 * page, Fulfilment tab, and is keyed by the SALES CHANNEL. Every "go assign
 * it" link in the connection screens goes through this one builder so none of
 * them can point at a different tab or a different side of the pair.
 *
 * @module features/connections/components
 */
import { DELIVERY_MAPPING_DEEP_LINK_PARAMS } from '../../mappings';

const FULFILMENT_TAB = 'fulfillment';

export function shippingAssignmentPath(channelConnectionId: string): string {
  const params = new URLSearchParams({ [DELIVERY_MAPPING_DEEP_LINK_PARAMS.tab]: FULFILMENT_TAB });
  return `/connections/${channelConnectionId}/mappings?${params.toString()}`;
}
