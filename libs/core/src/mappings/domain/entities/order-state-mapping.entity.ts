/**
 * Order State Mapping Domain Entity
 *
 * Connection-scoped override mapping a canonical OpenLinker `OrderStatus` to a
 * destination platform's native order-state id (stored as a string — for
 * PrestaShop the numeric order-state id). Slots in front of the adapter's
 * hardcoded default-install map (#862).
 *
 * Scoped by the **destination** connection (the shop whose state catalogue is
 * customised), unlike the source-scoped carrier/status mappings. The stored
 * value is intentionally platform-neutral (`externalStateId`) so a future
 * destination can reuse the table shape without a migration. Pure domain
 * entity with no framework deps.
 *
 * @module libs/core/src/mappings/domain/entities
 */

import type { OrderStatus } from '@openlinker/core/orders';

export class OrderStateMapping {
  constructor(
    public readonly id: string,
    public readonly connectionId: string,
    public readonly olStatus: OrderStatus,
    public readonly externalStateId: string,
  ) {}
}
