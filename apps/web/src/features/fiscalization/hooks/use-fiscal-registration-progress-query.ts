/**
 * useFiscalRegistrationProgressQuery (#2527)
 *
 * Where this order's registration has got to on one connection, polled.
 *
 * It exists because registration no longer happens inside the request that asks
 * for it (#2525). The work continues in the background, so the panel learns the
 * outcome by reading persisted state rather than by holding a request open - and
 * an order reopened halfway through shows the same in-flight state the operator
 * left, instead of nothing.
 *
 * The read is pure on the backend: polling it takes no lock, writes nothing and
 * cannot cause a registration.
 *
 * Disabled without a connection, because the answer is scoped to the same
 * (order, connection) pair the exactly-once key is.
 *
 * @module apps/web/src/features/fiscalization/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { fiscalizationQueryKeys } from '../api/fiscalization.query-keys';
import type { FiscalRegistrationProgressView } from '../api/fiscalization.types';
import { fiscalProgressPollInterval } from '../lib/fiscal-poll-interval';

export function useFiscalRegistrationProgressQuery(
  orderId: string,
  connectionId: string,
): UseQueryResult<FiscalRegistrationProgressView> {
  const apiClient = useApiClient();

  return useQuery<FiscalRegistrationProgressView>({
    queryKey: fiscalizationQueryKeys.progressForOrder(orderId, connectionId),
    enabled: Boolean(orderId) && Boolean(connectionId),
    queryFn: (): Promise<FiscalRegistrationProgressView> =>
      apiClient.fiscalization.getProgress(orderId, connectionId),
    refetchInterval: (query) => fiscalProgressPollInterval(query.state.data?.progress),
  });
}
