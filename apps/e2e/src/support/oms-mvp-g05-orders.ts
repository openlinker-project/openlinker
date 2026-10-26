/**
 * G05 stack-order finders (#3546)
 *
 * Cancel and edit are real channel acts: the order's source adapter has to
 * answer. A sandbox order in the right state cannot be manufactured
 * deterministically, so these helpers LOCATE one already ingested on the stack
 * (an Allegro connection's order) and classify it from facts the API exposes.
 * A spec that gets `null` back skips with a named reason - it never passes
 * silently.
 *
 * @module support
 */
import type { ApiClient } from '../api/api-client';
import type { OrderRecord, Shipment } from '../api/api.types';
import { PlatformType, type World } from '../world/world';

export type G05OrderKind = 'unshipped' | 'invoiced' | 'shipped';

const SCAN_LIMIT = 60;
const SHIPPED_STATUSES: readonly string[] = ['dispatched', 'delivered'];

function hasIssuedDocument(order: OrderRecord): boolean {
  return (order.salesDocument?.document ?? null) !== null;
}

function classify(order: OrderRecord, shipment: Shipment | null): G05OrderKind | null {
  if (order.cancelledAt) return null;
  if (shipment !== null && SHIPPED_STATUSES.includes(shipment.status)) return 'shipped';
  if (shipment !== null && shipment.status !== 'cancelled' && shipment.status !== 'failed') return null;
  return hasIssuedDocument(order) ? 'invoiced' : 'unshipped';
}

/**
 * First not-cancelled Allegro order of the wanted kind, or `null`. `unshipped`
 * means no live shipment and no issued sales document; `invoiced` means an
 * issued document and no dispatched shipment; `shipped` means a dispatched or
 * delivered shipment.
 */
export async function findAllegroOrder(
  api: ApiClient,
  world: World,
  kind: G05OrderKind,
): Promise<OrderRecord | null> {
  const allegroIds = new Set(world.connectionsFor(PlatformType.allegro).map((c) => c.id));
  if (allegroIds.size === 0) return null;
  const page = await api.orders.list({ limit: SCAN_LIMIT, offset: 0 });
  for (const order of page.items) {
    if (!allegroIds.has(order.sourceConnectionId)) continue;
    const shipment = await api.shipments.active(order.internalOrderId);
    if (classify(order, shipment) === kind) return order;
  }
  return null;
}

/** The first snapshot line with a quantity of at least 2, so it can be lowered. */
export function lowerableLineQuantity(order: OrderRecord): number | null {
  const items = (order.orderSnapshot as { items?: { quantity?: unknown }[] }).items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    if (typeof item.quantity === 'number' && item.quantity >= 2) return item.quantity;
  }
  return null;
}

/** The source-native order id the order was ingested from, or `null`. */
export function externalOrderIdOf(order: OrderRecord): string | null {
  const head = order.sourceEventId?.split(':')[0];
  return head ? head : null;
}
