/**
 * useOrderShipmentsQuery
 *
 * Thin wrapper over `useShipmentsQuery({ orderId })` for the order-detail
 * Shipment panel (#769). Hides the filter shape, keeps the cache key
 * consistent across the panel + its three mutations, and gives one place to
 * add order-shipments-specific options (e.g. a future `refetchInterval` while
 * the row is in a transient state).
 *
 * @module apps/web/src/features/shipments/hooks
 */
import type { UseQueryResult } from '@tanstack/react-query';
import type { PaginatedShipments } from '../api/shipments.types';
import { useShipmentsQuery } from './use-shipments-query';

export function useOrderShipmentsQuery(orderId: string): UseQueryResult<PaginatedShipments> {
  return useShipmentsQuery({ orderId });
}
