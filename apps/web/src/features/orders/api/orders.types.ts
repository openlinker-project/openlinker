/**
 * Orders Feature Types
 *
 * Frontend transport types for the orders API. Mirrors the backend
 * OrderRecordResponseDto and OrderSyncStatusResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/orders/api
 */

export const OrderSyncStatusValues = ['pending', 'syncing', 'synced', 'failed'] as const;
export type OrderSyncStatusValue = (typeof OrderSyncStatusValues)[number];

export interface OrderSyncStatus {
  destinationConnectionId: string;
  status: OrderSyncStatusValue;
  syncedAt: string | null;
  externalOrderId: string | null;
  externalOrderNumber: string | null;
  error: string | null;
}

export interface OrderRecord {
  internalOrderId: string;
  customerId: string | null;
  sourceConnectionId: string;
  sourceEventId: string | null;
  orderSnapshot: Record<string, unknown>;
  syncStatus: OrderSyncStatus[];
  createdAt: string;
  updatedAt: string;
}

export interface OrderFilters {
  sourceConnectionId?: string;
  syncStatus?: OrderSyncStatusValue;
  customerId?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface OrderPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedOrders {
  items: OrderRecord[];
  total: number;
  limit: number;
  offset: number;
}
