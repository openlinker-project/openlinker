/**
 * Order Document Emails Query Hook (#3551)
 *
 * Every attempt to email a sales document of this order to the buyer, for the
 * Activity timeline. Readable by admin, operator and viewer; carries no address.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderDocumentEmailEntry } from '../api/orders.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderDocumentEmailsQuery(
  internalOrderId: string,
): UseQueryResult<OrderDocumentEmailEntry[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: ordersQueryKeys.documentEmails(internalOrderId),
    queryFn: () => apiClient.orders.listDocumentEmails(internalOrderId),
    enabled: Boolean(internalOrderId),
  });
}
