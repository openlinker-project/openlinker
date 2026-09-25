/**
 * Inventory position owner (#3486, extracted from #3453)
 *
 * Which product master's book a product's stock belongs to, answered from the
 * provenance OpenLinker already mirrors (`inventory_items.sourceConnectionId`).
 * Shared by the routed-order sale decrement (#3453) and the returns restock
 * (#3486): both must write to the ONE master that owns a line, and v1 allows one
 * or two product masters feeding one warehouse (#3457), so "the" inventory
 * master is not a global answer.
 *
 * Pure, and deliberately neutral: it reports a closed reason and the counts a
 * caller needs, and leaves the operator-facing sentence to the caller, because
 * "which one sold it" and "which one to put it back into" are different
 * sentences about the same refusal.
 *
 * @module libs/core/src/inventory/domain/types
 */
import { LEGACY_SOURCE_CONNECTION_ID, type InventoryOwnerPosition } from './inventory.types';

/** Why no single owner could be named. */
export const InventoryOwnerBlockReasonValues = [
  /** No live position for the product (at the requested location, when one is given). */
  'no-position',
  /** A matching position carries `NULL` or `'legacy'` provenance — the owner is unknown. */
  'unattributed-owner',
  /** Matching positions name more than one owning connection. */
  'ambiguous-owner',
] as const;

export type InventoryOwnerBlockReason = (typeof InventoryOwnerBlockReasonValues)[number];

/** The outcome of resolving which connection owns a product's stock. */
export type InventoryOwnerResolution =
  | {
      readonly kind: 'owner';
      readonly ownerConnectionId: string;
      /** The owner's position a new quantity is written back to. */
      readonly position: InventoryOwnerPosition;
      /** Summed across the owner's matching positions. */
      readonly availableQuantity: number;
    }
  | {
      readonly kind: 'blocked';
      readonly reason: InventoryOwnerBlockReason;
      /** How many distinct owners matched; meaningful for `ambiguous-owner`. */
      readonly ownerCount: number;
    };

/** What to resolve an owner for. */
export interface InventoryOwnerQuery {
  readonly productId: string;
  readonly productVariantId: string | null;
  /** `null` accepts every live position; otherwise that location or pooled ones. */
  readonly locationId: string | null;
}

/**
 * Which connection owns the stock for one product (and variant).
 *
 * - Only positions at the requested location or pooled ones
 *   (`locationId IS NULL`) count; a `null` location accepts every live position.
 * - Variant-level rows win; product-level rows are used only when the variant
 *   has none, which is the shape a simple product without a synthetic variant
 *   row takes.
 * - `NULL` or `'legacy'` provenance refuses: writing to a book OpenLinker cannot
 *   name is guessing, and a wrong guess moves real stock in the wrong shop.
 * - More than one owner refuses for the same reason.
 *
 * When one owner has several positions, the one AT the requested location is
 * the write-back target, else the pooled one.
 */
export function resolveInventoryPositionOwner(
  positions: readonly InventoryOwnerPosition[],
  query: InventoryOwnerQuery
): InventoryOwnerResolution {
  const atLocation = positions.filter(
    (position) =>
      position.productId === query.productId &&
      (query.locationId === null ||
        position.locationId === null ||
        position.locationId === query.locationId)
  );

  const variantRows =
    query.productVariantId === null
      ? []
      : atLocation.filter((position) => position.productVariantId === query.productVariantId);
  const candidates =
    variantRows.length > 0
      ? variantRows
      : atLocation.filter((position) => position.productVariantId === null);

  if (candidates.length === 0) {
    return { kind: 'blocked', reason: 'no-position', ownerCount: 0 };
  }

  const unattributed = candidates.some(
    (position) =>
      position.sourceConnectionId === null ||
      position.sourceConnectionId === LEGACY_SOURCE_CONNECTION_ID
  );
  if (unattributed) {
    return { kind: 'blocked', reason: 'unattributed-owner', ownerCount: 0 };
  }

  const owners = [...new Set(candidates.map((position) => position.sourceConnectionId as string))];
  if (owners.length > 1) {
    return { kind: 'blocked', reason: 'ambiguous-owner', ownerCount: owners.length };
  }

  const position =
    candidates.find(
      (candidate) => query.locationId !== null && candidate.locationId === query.locationId
    ) ??
    candidates.find((candidate) => candidate.locationId === null) ??
    candidates[0];

  return {
    kind: 'owner',
    ownerConnectionId: owners[0],
    position,
    availableQuantity: candidates.reduce(
      (sum, candidate) => sum + candidate.availableQuantity,
      0
    ),
  };
}
