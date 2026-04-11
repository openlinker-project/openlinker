/**
 * Order Record Types
 *
 * Type definitions for order record read operations. Defines filters,
 * pagination, and paginated result types for querying order records.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { OrderRecord } from '../entities/order-record.entity';

/**
 * Sync status filter values for order queries
 */
export const OrderSyncStatusFilterValues = ['pending', 'syncing', 'synced', 'failed'] as const;

/**
 * Sync status filter type
 */
export type OrderSyncStatusFilter = (typeof OrderSyncStatusFilterValues)[number];

/**
 * Order record filters for list queries
 */
export interface OrderRecordFilters {
  sourceConnectionId?: string;
  syncStatus?: OrderSyncStatusFilter;
  customerId?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

/**
 * Pagination parameters for order record queries
 */
export interface OrderRecordPagination {
  limit: number;
  offset: number;
}

/**
 * Paginated order records result
 */
export interface PaginatedOrderRecords {
  items: OrderRecord[];
  total: number;
}
