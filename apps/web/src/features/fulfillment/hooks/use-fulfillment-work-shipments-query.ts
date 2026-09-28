/**
 * The shipment(s) dispatched for one fulfilment task (#3292)
 *
 * Backs the detail page's "Shipment" panel. An empty array is the normal
 * "nothing dispatched yet" state — `FulfillmentApi.listShipments`'s own
 * docblock says so — so this hook draws no distinction between "no data yet"
 * and "genuinely nothing has shipped"; the panel reads that from the array's
 * length once the read has settled.
 *
 * Disabled on an absent `workId`, the same guard `useFulfillmentWorkQuery`
 * applies, and for the same reason: an absent route param must not request
 * `/fulfillment/works/undefined/shipments`.
 *
 * @module apps/web/src/features/fulfillment/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { fulfillmentQueryKeys } from '../api/fulfillment.query-keys';
import type { FulfillmentTaskShipment } from '../api/fulfillment.types';

export function useFulfillmentWorkShipmentsQuery(
  workId: string
): UseQueryResult<FulfillmentTaskShipment[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: fulfillmentQueryKeys.shipments(workId),
    queryFn: () => apiClient.fulfillment.listShipments(workId),
    enabled: Boolean(workId),
  });
}
