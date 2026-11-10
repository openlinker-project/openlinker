/**
 * Stock movement history - wire types (#3568)
 *
 * Hand-written mirror of `InventoryMovementResponseDto` on
 * `GET /inventory/movements`. A row is either a stock movement or a
 * reservation shown as "Promised" (a reservation never changes the stock).
 * Dates are ISO 8601 strings.
 *
 * @module apps/web/src/features/inventory/api
 */

export const InventoryMovementReasonValues = [
  'sale',
  'cancellation_restore',
  'return_restock',
  'manual_correction',
  'master_sync',
] as const;
export type InventoryMovementReason = (typeof InventoryMovementReasonValues)[number];

export const InventoryHistoryKindFilterValues = ['all', 'movements', 'promised'] as const;
export type InventoryHistoryKindFilter = (typeof InventoryHistoryKindFilterValues)[number];

export type InventoryHistoryRowKind = 'movement' | 'reservation';
export type InventoryMovementSourceKind = 'order' | 'return' | 'operator' | 'master_sync';

export interface InventoryMovementRow {
  kind: InventoryHistoryRowKind;
  id: string;
  productId: string;
  productVariantId: string | null;
  sku: string | null;
  productName: string | null;
  locationId: string | null;
  sourceConnectionId: string | null;
  /** Null on a reservation row. */
  reason: InventoryMovementReason | null;
  /** Movement: pending | applied | refused | in_doubt. Reservation: held | released | consumed | expired. */
  status: string;
  /** For a reservation this is the promised quantity. */
  quantityDelta: number;
  quantityBefore: number | null;
  quantityAfter: number | null;
  sourceKind: InventoryMovementSourceKind | null;
  sourceRef: string | null;
  /** Human label for the source: the order number or the return number. Absent on older servers. */
  sourceLabel?: string | null;
  operatorReason: string | null;
  note: string | null;
  /** The user who made a manual correction. */
  actorUserId: string | null;
  /** Display name only (never an email); null when there is no actor or the user is gone. */
  actorName: string | null;
  refusalReason: string | null;
  refusalDetail: string | null;
  occurredAt: string;
  /**
   * The sync run that wrote this row (#4062): rows sharing it came from one
   * run. Null outside a sync and on reservation rows; absent on older servers.
   */
  syncRunId?: string | null;
}

/** How one write to a channel went (#4062). */
export const ChannelQuantityPushOutcomeValues = ['sent', 'failed', 'skipped'] as const;
export type ChannelQuantityPushOutcome = (typeof ChannelQuantityPushOutcomeValues)[number];

/** One quantity OpenLinker wrote (or tried to write) to a channel listing. */
export interface ChannelQuantityPush {
  id: string;
  connectionId: string;
  externalOfferId: string;
  /** Null when no quantity could be resolved (the write was suppressed). */
  quantity: number | null;
  outcome: ChannelQuantityPushOutcome;
  errorCode: string | null;
  message: string | null;
  pushedAt: string;
}

export interface ChannelQuantityPushes {
  items: ChannelQuantityPush[];
}

export interface InventoryMovementFilters {
  productId?: string;
  productVariantId?: string;
  reasons?: readonly InventoryMovementReason[];
  sourceConnectionId?: string;
  /** ISO 8601 instants, inclusive. */
  from?: string;
  to?: string;
  needsAttention?: boolean;
  kind?: InventoryHistoryKindFilter;
  search?: string;
}

export interface InventoryMovementPagination {
  limit?: number;
  offset?: number;
}

/** A page fetched WITHOUT its total - see `RowsPage`. */
export interface InventoryMovementsPage {
  items: InventoryMovementRow[];
  limit: number;
  offset: number;
}
