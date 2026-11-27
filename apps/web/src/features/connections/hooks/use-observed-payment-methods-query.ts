import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ObservedPaymentMethods } from '../api/connections.types';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Read the payment gateway ids a connection's recent orders carried
 * (`GET /connections/:id/payment-methods/observed`, #3775).
 *
 * Callers gate `enabled` on the connection's `enabledCapabilities` including
 * `'OrderSource'`. It lives under the `['connections', ...]` key prefix, so a
 * saved connection update (which invalidates that prefix) refreshes it - the
 * operator-mapped and resolved columns never show pre-save values.
 */
export function useObservedPaymentMethodsQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ObservedPaymentMethods, Error> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.observedPaymentMethods(connectionId),
    queryFn: () => apiClient.connections.getObservedPaymentMethods(connectionId),
    enabled: options?.enabled ?? true,
  });
}
