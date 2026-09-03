/**
 * Shipment Direction Types
 *
 * Which way the goods travel. `'outbound'` is the seller shipping to a buyer —
 * every shipment this repository has ever been able to create. `'return'` is a
 * return label for goods coming back (ADR-060, #2373).
 *
 * The discriminator exists because a return label IS a shipment (same carrier,
 * same waybill, same tracking poll), so it shares the table — but every
 * pre-existing predicate and the branch-1 duplicate guard assume one direction.
 *
 * @module libs/core/src/shipping/domain/types
 */

export const ShipmentDirectionValues = ['outbound', 'return'] as const;
export type ShipmentDirection = (typeof ShipmentDirectionValues)[number];
