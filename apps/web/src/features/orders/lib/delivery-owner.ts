/**
 * Delivery Owner Resolution
 *
 * Pure, framework-free helper that resolves the BE-computed delivery routing
 * (#1791 `deliveryResolution` + #1792 `deliveryRider`) onto the presentational
 * "owner" a delivery badge renders — the connection whose colour/initial the
 * `ConnectionDot` shows, plus whether it's a carrier or the destination shop.
 *
 * This is id → display-name resolution ONLY (the one FE-side lookup #1776
 * sanctions): it never re-derives routing the backend already resolved. The
 * three owner shapes mirror the chip's states (#1793):
 * - a LIVE own-carrier route (`ol_managed_carrier` / `source_brokered`, an
 *   available processor) → the carrier connection (falling back to the rider's
 *   heuristic candidate carrier when the id can't be resolved);
 * - an explicit shop/OMP rule with a `processorConnectionId` → that connection;
 * - the default shop fallback (`omp_fulfilled` / no processor id) → a generic,
 *   name-less shop owner.
 *
 * @module apps/web/src/features/orders/lib
 */
import type { OrderDeliveryResolution, OrderDeliveryRider } from '../api/orders.types';
import { hasLiveOlCarrierRoute } from './delivery-outcome';

/** Presentational delivery-badge owner (see `ConnectionDot`). */
export interface DeliveryOwner {
  /** Full connection name (badge tooltip + a11y text); `null` → generic glyph. */
  name: string | null;
  /** Hue + initial seed source when `name` is null; also carried through when known. */
  platformType: string | null;
  /** Whether the owner is a carrier or the destination shop (drives the generic glyph). */
  variant: 'shop' | 'carrier';
}

/** Minimal connection projection the resolver needs (id → name + platformType). */
export interface DeliveryOwnerConnectionInfo {
  name: string;
  platformType: string;
}

/**
 * Resolve the delivery owner for a badge. `connectionsById` is the caller's
 * `useConnectionsQuery`-backed id → {name, platformType} map (loaded on both the
 * list and the order-detail surfaces).
 */
export function resolveDeliveryOwner(
  resolution: OrderDeliveryResolution | undefined | null,
  rider: OrderDeliveryRider | undefined | null,
  connectionsById: ReadonlyMap<string, DeliveryOwnerConnectionInfo>,
): DeliveryOwner {
  const processorConnectionId = resolution?.processorConnectionId ?? null;
  const connection = processorConnectionId ? connectionsById.get(processorConnectionId) : undefined;

  // Carrier route (a live own-carrier processor): the badge names the CARRIER
  // connection, not the OL orchestrator. When the id can't be resolved, fall
  // back to the rider's heuristic candidate carrier; else a name-less carrier.
  if (hasLiveOlCarrierRoute(resolution)) {
    if (connection) {
      return { name: connection.name, platformType: connection.platformType, variant: 'carrier' };
    }
    const candidate = rider?.candidateCarrier;
    if (candidate) {
      return { name: candidate.displayName, platformType: candidate.platformType, variant: 'carrier' };
    }
    return { name: null, platformType: null, variant: 'carrier' };
  }

  // Explicit shop/OMP rule with a resolvable processor connection.
  if (connection) {
    return { name: connection.name, platformType: connection.platformType, variant: 'shop' };
  }

  // Default shop fallback (omp_fulfilled / no processor id) — generic, name-less.
  return { name: null, platformType: null, variant: 'shop' };
}
