/**
 * Shared reads for the connection pages' shipping cards (#3958)
 *
 * Both cards answer a question about routing rules, which are stored per ORDER
 * SOURCE: "which delivery methods go to this carrier" has to look at every
 * source, "how does this source ship" at one. These helpers keep the source
 * list and the delivery-method label lookup identical for both.
 *
 * @module features/connections/components
 */
import type { MappingOption, RoutingRule, useMappingOptions } from '../../mappings';
import type { Connection } from '../api/connections.types';

/**
 * Only the source's delivery methods are needed. Module-level so the set is
 * referentially stable: the options hook keys its queries off it.
 */
export const DELIVERY_METHOD_OPTION_KEYS: NonNullable<Parameters<typeof useMappingOptions>[1]> =
  new Set(['allegroDeliveryMethods']);

export const ORDER_SOURCE_CAPABILITY = 'OrderSource';
export const CARRIER_CAPABILITY = 'ShippingProviderManager';

/**
 * Active connections whose orders can be routed. A disabled source sends no
 * orders, so listing its routes on a carrier's page would describe nothing
 * that happens.
 */
export function activeOrderSources(
  connections: readonly Connection[] | undefined,
  excludeConnectionId: string
): Connection[] {
  return (connections ?? []).filter(
    (c) =>
      c.id !== excludeConnectionId &&
      c.status === 'active' &&
      c.enabledCapabilities.includes(ORDER_SOURCE_CAPABILITY)
  );
}

/** Rules that send a delivery method to the given carrier connection. */
export function rulesRoutedTo(
  rules: readonly RoutingRule[] | undefined,
  carrierConnectionId: string
): RoutingRule[] {
  return (rules ?? []).filter((r) => r.processorConnectionId === carrierConnectionId);
}

/**
 * The delivery method's name as the source lists it, falling back to its id
 * when the list is not loaded (or no longer carries the method) so a routed
 * method is never silently dropped from the card.
 */
export function deliveryMethodLabel(methods: readonly MappingOption[], methodId: string): string {
  return methods.find((m) => m.value === methodId)?.label ?? methodId;
}
