/**
 * Orders routed to a destination that owns fulfilment (#2118)
 *
 * An external OMS/WMS picks, packs and ships by itself, so OpenLinker's own
 * "Mark packed" control and packed tick would ask an operator to tick something
 * that system already did. The connection carries an operator-declared display
 * flag (`config.fulfilmentOwnedByDestination`); this is the pure rule that turns
 * "which connections are flagged" into "is THIS order one of theirs".
 *
 * An order counts as destination-fulfilled when ANY of its destinations is
 * flagged: it was routed to a system that packs for itself. Display-only - it
 * decides what is rendered and enforces nothing, so `POST /orders/:id/packed`
 * still succeeds and that system can still report an order as packed.
 *
 * @module features/orders/lib
 */

export function isFulfilmentOwnedByDestination(
  syncStatus: ReadonlyArray<{ readonly destinationConnectionId: string }> | null | undefined,
  ownedConnectionIds: ReadonlySet<string>
): boolean {
  if (!syncStatus || ownedConnectionIds.size === 0) {
    return false;
  }
  return syncStatus.some((entry) => ownedConnectionIds.has(entry.destinationConnectionId));
}
