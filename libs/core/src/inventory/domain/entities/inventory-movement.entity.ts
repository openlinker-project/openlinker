/**
 * Inventory Movement Domain Entity (#3565)
 *
 * One append-only record of a change to a stock position's available quantity,
 * or of an attempted change that did not land (`refused`, `in_doubt`). Anemic
 * (ADR-011): the only mutations are the repository's guarded settle / attach.
 *
 * @module libs/core/src/inventory/domain/entities
 */
import type {
  InventoryMovementOperatorReason,
  InventoryMovementReason,
  InventoryMovementSourceKind,
  InventoryMovementStatus,
} from '../types/inventory-movement.types';

export class InventoryMovement {
  constructor(
    public readonly id: string,
    public readonly productId: string,
    public readonly productVariantId: string | null,
    public readonly locationId: string | null,
    public readonly sourceConnectionId: string | null,
    public readonly reason: InventoryMovementReason,
    public readonly status: InventoryMovementStatus,
    /** The requested change for `pending` / `refused` / `in_doubt`; the real one for `applied`. */
    public readonly quantityDelta: number,
    /** `null` where unknown (`in_doubt`, `refused`, not yet attached). */
    public readonly quantityBefore: number | null,
    public readonly quantityAfter: number | null,
    public readonly sourceKind: InventoryMovementSourceKind,
    public readonly sourceRef: string | null,
    public readonly actorUserId: string | null,
    public readonly operatorReason: InventoryMovementOperatorReason | null,
    public readonly note: string | null,
    public readonly idempotencyKey: string | null,
    public readonly refusalReason: string | null,
    /** The adapter's own sentence, verbatim. */
    public readonly refusalDetail: string | null,
    public readonly occurredAt: Date,
    public readonly createdAt: Date
  ) {}
}
