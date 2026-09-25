/**
 * Fulfilment Routing Eligibility (#3487, epic #3460)
 *
 * Pure rules deciding whether an ingested order may be handed to the fulfilment
 * router at all, before any router is selected.
 *
 * Three rules live here, one per product decision in epic #3460: an order from
 * the operator's own shop (#3487), an order another system has been told to
 * ship (#3488) and an order the product master already received before routing
 * was switched on (#3455) all keep today's path.
 *
 * Each skip is also REPORTED, as one {@link FulfillmentRoutingSkipReason}
 * persisted on the order: the operator's question is always the same ("why is
 * this order not on the pack bench?"), so it gets one answer in one place
 * rather than a column per rule.
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
import {
  FULFILLMENT_PROCESSOR_KIND,
  type FulfillmentRoutingResolution,
} from '@openlinker/core/mappings';
import type { OrderSyncStatus } from './order-sync.types';

/**
 * Why OpenLinker deliberately did not route an order to the pack bench while
 * the OMS is on. `order_records.fulfillmentRoutingSkipReason`.
 *
 * NOT a hold: a skipped order follows today's path (it is mirrored to the
 * product master), which is what separates this from `fulfillmentBlockReason`,
 * whose every value means "held, not mirrored". Recorded only while a
 * connection claims A2 - with the OMS off nothing is routed, so there is
 * nothing to explain.
 */
export const FulfillmentRoutingSkipReasonValues = [
  /** The order was placed in the operator's own shop (a product master), #3487. */
  'own-shop-order',
  /** An ADR-012 rule routes its delivery method to another system (`omp_fulfilled`), #3488. */
  'shipped-by-other-system',
  /** The product master already received it before routing was switched on, #3455. */
  'mirrored-before-routing',
] as const;

export type FulfillmentRoutingSkipReason = (typeof FulfillmentRoutingSkipReasonValues)[number];

/**
 * Read-side coercion. The column is plain `text` with no check constraint, so a
 * value written by a newer release and then rolled back must read as "no
 * reason" rather than widening the union at runtime.
 */
export const isFulfillmentRoutingSkipReason = (
  value: unknown
): value is FulfillmentRoutingSkipReason =>
  typeof value === 'string' &&
  (FulfillmentRoutingSkipReasonValues as readonly string[]).includes(value);

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

/** The slice of an ADR-012 routing resolution {@link isOrderShippedElsewhere} reads. */
export type RoutingEligibilityResolution = Pick<
  FulfillmentRoutingResolution,
  'processorKind' | 'source'
>;

/**
 * Whether the operator has said this order's delivery method is shipped by
 * another system (#3488): an ADR-012 rule for the order's `(source, delivery
 * method)` resolves to `omp_fulfilled`, so the parcel is packed and shipped
 * there and must not also appear on OpenLinker's pack bench.
 *
 * Only a matched RULE counts. `IFulfillmentRoutingService.resolve` answers
 * `omp_fulfilled` with `source: 'default'` for every order no rule covers, so
 * testing the kind alone would stop routing every order on an install that
 * never configured a rule - i.e. switch the OMS off while it reports itself on.
 *
 * `null` - the routing read failed - is not a positive answer, so the order is
 * still routed: the operator then sees it on the bench rather than losing it.
 *
 * `processorAvailable` is deliberately not consulted. It reports whether OL can
 * drive the named processor, which says nothing about who ships the parcel; a
 * rule naming a disabled shop still says the shop ships it.
 */
export function isOrderShippedElsewhere(
  resolution: RoutingEligibilityResolution | null
): boolean {
  return (
    resolution?.source === 'rule' &&
    resolution.processorKind === FULFILLMENT_PROCESSOR_KIND.OmpFulfilled
  );
}

/**
 * Whether the order was already created in a destination before routing was
 * switched on (#3455): at least one destination `syncStatus` row is `synced`.
 *
 * A routed order is never mirrored - the intercept holds it and no destination
 * row is written - so a `synced` row can only come from the path the order took
 * before routing applied to it. Routing it now would put a parcel the product
 * master already has (and may already have packed) on the pack bench as well,
 * and lower its stock a second time through #3453's decrement.
 *
 * Only `synced` counts, the same reading #2588's `alreadyProvisioned` makes:
 * `pending` (a hold withheld provisioning) and `failed` mean the destination
 * does NOT have the order, so routing it is the right answer.
 */
export function isOrderMirroredBeforeRouting(
  syncStatus: readonly Pick<OrderSyncStatus, 'status'>[] | null | undefined
): boolean {
  return syncStatus?.some((row) => row.status === 'synced') ?? false;
}
