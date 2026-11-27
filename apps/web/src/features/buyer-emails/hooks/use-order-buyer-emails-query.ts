/**
 * Order Buyer Emails Query Hook (#3555)
 *
 * Every automatic buyer email attempted for one order: sent, suppressed with
 * its reason, or bounced. Carries no address.
 *
 * @module apps/web/src/features/buyer-emails/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { buyerEmailsQueryKeys } from '../api/buyer-emails.query-keys';
import type { BuyerEmailDelivery } from '../api/buyer-emails.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useOrderBuyerEmailsQuery(
  internalOrderId: string,
): UseQueryResult<BuyerEmailDelivery[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: buyerEmailsQueryKeys.forOrder(internalOrderId),
    queryFn: () => apiClient.buyerEmails.listForOrder(internalOrderId),
    enabled: Boolean(internalOrderId),
  });
}
