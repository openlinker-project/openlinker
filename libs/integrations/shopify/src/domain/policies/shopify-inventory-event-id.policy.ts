/**
 * Shopify Inventory Event Id Policy
 *
 * `inventory_levels/update` names an inventory ITEM and a LOCATION, while the
 * inbound job carries a single external id. The decoder therefore packs both
 * into one self-describing id (`inventory-item:{itemId}:{locationId}`, numeric
 * tails), and the inventory master adapter unpacks it when the sync asks which
 * product the event stands for (`InventoryEventTargetResolver`). A product id
 * (the `products/update` inventory event) never matches the prefix, so the two
 * kinds of id cannot be confused.
 *
 * @module libs/integrations/shopify/src/domain/policies
 */

const PREFIX = 'inventory-item:';
const PACKED = /^inventory-item:(\d+):(\d+)$/;

export interface ShopifyInventoryEventTarget {
  readonly inventoryItemId: string;
  readonly locationId: string;
}

export function packShopifyInventoryEventId(inventoryItemId: string, locationId: string): string {
  return `${PREFIX}${inventoryItemId}:${locationId}`;
}

/** The packed target, or null for any other id (a product id, garbage). */
export function unpackShopifyInventoryEventId(externalId: string): ShopifyInventoryEventTarget | null {
  const match = PACKED.exec(externalId);
  return match === null ? null : { inventoryItemId: match[1], locationId: match[2] };
}
