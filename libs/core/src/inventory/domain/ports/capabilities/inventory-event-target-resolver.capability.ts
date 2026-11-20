/**
 * Inventory Event Target Resolver Capability
 *
 * Optional sub-capability of `InventoryMasterPort`. A master whose stock
 * webhook is keyed by something other than the product (Shopify's
 * `inventory_levels/update` names an inventory item and a location) declares
 * `implements InventoryEventTargetResolver`, and the inventory sync asks it,
 * before reading, which product external id the event stands for.
 *
 * It lives on the sync path and not at webhook ingress on purpose: ingress is
 * synchronous and I/O-free (a translator is a pure transform), whereas the
 * answer costs a master read. Resolving in the job gives that read the job's
 * retry ladder and keeps the HTTP request fast.
 *
 * The id handed in is whatever the plugin's translator put on the event. A
 * master that sends product ids for some events (Shopify's `products/update`
 * also yields an inventory event) returns an id it does not recognise
 * unchanged, so the hook is safe to call for every id.
 *
 * `null` means "nothing to sync": the event concerns a location the connection
 * does not track, or an item the master no longer has. It is a normal outcome,
 * not a failure: the sync then ends without reading or writing anything.
 *
 * Guard-only: NOT in any adapter manifest and NOT in `CoreCapabilityValues`,
 * for the reason `bulk-inventory-reader.capability.ts` states.
 *
 * @module libs/core/src/inventory/domain/ports/capabilities
 * @see {@link InventoryMasterPort} for the base port
 */
import type { InventoryMasterPort } from '../inventory-master.port';

export interface InventoryEventTargetResolver {
  /** The product external id to sync for an event-native id, or null when there is nothing to sync. */
  resolveEventProductExternalId(eventExternalId: string): Promise<string | null>;
}

export function isInventoryEventTargetResolver(
  adapter: InventoryMasterPort
): adapter is InventoryMasterPort & InventoryEventTargetResolver {
  return (
    typeof (adapter as Partial<InventoryEventTargetResolver>).resolveEventProductExternalId ===
    'function'
  );
}
