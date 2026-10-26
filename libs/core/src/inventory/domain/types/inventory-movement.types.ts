/**
 * Inventory Movement Types (#3565)
 *
 * Vocabulary of the append-only stock movement ledger (`inventory_movements`).
 * Deliberately NOT {@link InventoryAdjustmentReasonValues}: that closed union is
 * the vocabulary OpenLinker speaks to a product master's adapter, whereas this one
 * says why OpenLinker's own mirror of the stock changed - which includes changes
 * (`master_sync`) no adapter write caused.
 *
 * @module libs/core/src/inventory/domain/types
 */

export const InventoryMovementReasonValues = [
  'sale',
  'cancellation_restore',
  'return_restock',
  'manual_correction',
  'master_sync',
] as const;
export type InventoryMovementReason = (typeof InventoryMovementReasonValues)[number];

/**
 * `pending` is a claimed manual correction not yet answered, `applied` changed the
 * stock, `refused` is a known refusal (nothing changed), `in_doubt` crossed the
 * boundary with an unknown outcome and is never retried automatically.
 */
export const InventoryMovementStatusValues = ['pending', 'applied', 'refused', 'in_doubt'] as const;
export type InventoryMovementStatus = (typeof InventoryMovementStatusValues)[number];

export const InventoryMovementSourceKindValues = [
  'order',
  'return',
  'operator',
  'master_sync',
] as const;
export type InventoryMovementSourceKind = (typeof InventoryMovementSourceKindValues)[number];

/** The operator's own classification of a manual correction. */
export const InventoryMovementOperatorReasonValues = [
  'count_correction',
  'found',
  'damaged',
  'other',
] as const;
export type InventoryMovementOperatorReason = (typeof InventoryMovementOperatorReasonValues)[number];

/** The row kinds a history read can return. `reservation` rows are derived, never stored here. */
export const InventoryHistoryKindValues = ['movement', 'reservation'] as const;
export type InventoryHistoryKind = (typeof InventoryHistoryKindValues)[number];

/** Filter selecting which row kinds a history read returns. */
export const InventoryHistoryKindFilterValues = ['all', 'movements', 'promised'] as const;
export type InventoryHistoryKindFilter = (typeof InventoryHistoryKindFilterValues)[number];

/**
 * What a caller of `setInventory` says about WHY the stock changes, so the ledger
 * row carries the real reason instead of defaulting to `master_sync`.
 */
export interface InventoryMovementAttribution {
  readonly reason: InventoryMovementReason;
  readonly sourceKind: InventoryMovementSourceKind;
  readonly sourceRef?: string | null;
  readonly actorUserId?: string | null;
}

/**
 * Completes a row a caller already claimed (the manual correction's `pending`
 * row): `setInventory` fills its before/after quantity rather than inserting a
 * second row for the same change.
 */
export interface InventoryMovementAttachment {
  readonly attachToMovementId: string;
}

export type InventoryMovementContext = InventoryMovementAttribution | InventoryMovementAttachment;

export function isInventoryMovementAttachment(
  context: InventoryMovementContext
): context is InventoryMovementAttachment {
  return 'attachToMovementId' in context;
}

/** Input for appending a finished (applied) movement row. */
export interface AppendInventoryMovementInput {
  readonly productId: string;
  readonly productVariantId: string | null;
  readonly locationId: string | null;
  readonly sourceConnectionId: string | null;
  readonly reason: InventoryMovementReason;
  readonly quantityDelta: number;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly sourceKind: InventoryMovementSourceKind;
  readonly sourceRef: string | null;
  readonly actorUserId: string | null;
  readonly occurredAt: Date;
}

/** Input for claiming a `pending` row before a boundary crossing (manual correction). */
export interface InsertPendingInventoryMovementInput {
  readonly productId: string;
  readonly productVariantId: string | null;
  readonly locationId: string | null;
  readonly sourceConnectionId: string | null;
  readonly reason: InventoryMovementReason;
  readonly quantityDelta: number;
  readonly sourceKind: InventoryMovementSourceKind;
  readonly sourceRef: string | null;
  readonly actorUserId: string | null;
  readonly operatorReason: InventoryMovementOperatorReason | null;
  readonly note: string | null;
  readonly idempotencyKey: string;
  readonly occurredAt: Date;
}

/** How a `pending` row ended. `applied` quantities may arrive later via an attachment. */
export interface SettleInventoryMovementInput {
  readonly status: Exclude<InventoryMovementStatus, 'pending'>;
  readonly quantityBefore?: number | null;
  readonly quantityAfter?: number | null;
  readonly refusalReason?: string | null;
  readonly refusalDetail?: string | null;
}

export interface InventoryMovementFilters {
  readonly productId?: string;
  readonly productVariantId?: string;
  readonly reasons?: readonly InventoryMovementReason[];
  readonly sourceConnectionId?: string;
  readonly from?: Date;
  readonly to?: Date;
  /** Ledger rows whose status is `refused` or `in_doubt`; excludes promised rows. */
  readonly needsAttention?: boolean;
  readonly kind?: InventoryHistoryKindFilter;
  /** Case-insensitive substring of a variant's SKU or its product's name. */
  readonly search?: string;
}

export interface InventoryMovementPagination {
  readonly limit: number;
  readonly offset: number;
}

/**
 * One row of the merged history: a stored movement, or a reservation shown as
 * "Promised" (a reservation never changes `availableQuantity`, ADR-061).
 */
export interface InventoryHistoryRow {
  readonly kind: InventoryHistoryKind;
  readonly id: string;
  readonly productId: string;
  readonly productVariantId: string | null;
  readonly sku: string | null;
  /** The product's name: variants carry no name of their own. */
  readonly productName: string | null;
  readonly locationId: string | null;
  readonly sourceConnectionId: string | null;
  /** `null` on a reservation row. */
  readonly reason: InventoryMovementReason | null;
  /** Movement status, or the reservation's own status (`held | released | consumed | expired`). */
  readonly status: string;
  /** Signed stock change for a movement; the promised quantity for a reservation. */
  readonly quantityDelta: number;
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly sourceKind: InventoryMovementSourceKind | null;
  readonly sourceRef: string | null;
  readonly operatorReason: InventoryMovementOperatorReason | null;
  readonly note: string | null;
  readonly refusalReason: string | null;
  readonly refusalDetail: string | null;
  readonly occurredAt: Date;
}

export interface PaginatedInventoryHistory {
  readonly rows: InventoryHistoryRow[];
  readonly total: number;
}

/** Default retention window for ledger rows (days), overridable in Operational Settings. */
export const INVENTORY_MOVEMENT_RETENTION_DAYS_DEFAULT = 365;
