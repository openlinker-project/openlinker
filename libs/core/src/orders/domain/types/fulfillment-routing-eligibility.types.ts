/**
 * Fulfilment Routing Eligibility (#3487, epic #3460)
 *
 * Pure rules deciding whether an ingested order may be handed to the fulfilment
 * router at all, before any router is selected.
 *
 * Product decision (epic #3460): with the OMS on, an order placed in the
 * operator's OWN shop — the product master — is not routed. It stays in that
 * shop's back office and is packed there, exactly as it is today. Routing it
 * would put the same parcel on OpenLinker's pack bench as well, so the operator
 * could pack and ship it twice.
 *
 * Capability-driven, never `platformType`: a PrestaShop or WooCommerce connection
 * is usually both a product master and an `OrderSource`, but the thing that
 * makes an order "from the operator's own shop" is that its source connection
 * owns the catalogue, whatever the platform is.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { CoreCapability } from '@openlinker/core/integrations';

/** The capability that marks a connection as the operator's own shop. */
const OWN_SHOP_CAPABILITY: CoreCapability = 'ProductMaster';

/** The slice of a connection this rule reads. */
export interface RoutingEligibilityConnection {
  readonly id: string;
  readonly enabledCapabilities: readonly string[];
}

/**
 * Whether the order was ingested through a connection that is a product master.
 *
 * Resolved from the connection the order ARRIVED through, never from its lines:
 * a marketplace order whose products happen to come from the shop is still a
 * marketplace order and is routed.
 *
 * Reads `enabledCapabilities`, not the adapter's advertised list — an operator
 * who has switched `ProductMaster` off on a connection has said it is not the
 * catalogue. The connection's status is deliberately NOT consulted: an order that
 * did arrive through the shop is a shop order even while that connection is
 * disabled, and routing it would be the double shipment this rule prevents.
 *
 * A source connection absent from `connections` is not a product master, so the
 * order keeps today's routing behaviour.
 */
export function isOrderFromOwnProductMaster(
  connections: readonly RoutingEligibilityConnection[],
  sourceConnectionId: string
): boolean {
  const source = connections.find((connection) => connection.id === sourceConnectionId);
  return source?.enabledCapabilities.includes(OWN_SHOP_CAPABILITY) ?? false;
}
