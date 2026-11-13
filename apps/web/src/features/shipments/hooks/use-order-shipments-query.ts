/**
 * useOrderShipmentsQuery
 *
 * The order-detail Shipment panel's read (#769). It keeps the same cache key as
 * `useShipmentsQuery({ orderId })`, so the panel's mutations still invalidate it.
 *
 * It also keeps itself current (#4104): a tracking number and the later
 * statuses are written by the status sync worker and nothing pushes them to an
 * open page, so it re-reads while a shipment can still change, and when a
 * status changes it re-reads the order too (header, delivery badge), which is a
 * different query that would otherwise stay stale until a reload.
 *
 * @module apps/web/src/features/shipments/hooks
 */
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { ordersQueryKeys } from '../../orders';
import { shipmentsQueryKeys } from '../api/shipments.query-keys';
import type { PaginatedShipments } from '../api/shipments.types';
import {
  ORDER_SHIPMENTS_POLL_MS,
  hasShipmentInProgress,
  shipmentStatusSignature,
} from '../lib/shipment-polling';

export function useOrderShipmentsQuery(orderId: string): UseQueryResult<PaginatedShipments> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const filters = { orderId };

  const query = useQuery({
    queryKey: shipmentsQueryKeys.list(filters),
    queryFn: () => apiClient.shipments.list(filters),
    refetchInterval: (current) => {
      const items = current.state.data?.items ?? [];
      return hasShipmentInProgress(items) && !document.hidden ? ORDER_SHIPMENTS_POLL_MS : false;
    },
  });

  const signature = query.data ? shipmentStatusSignature(query.data.items) : null;
  const previousSignature = useRef<string | null>(null);
  useEffect(() => {
    if (signature === null) return;
    if (previousSignature.current !== null && previousSignature.current !== signature) {
      void queryClient.invalidateQueries({ queryKey: ordersQueryKeys.all });
    }
    previousSignature.current = signature;
  }, [signature, queryClient]);

  return query;
}
