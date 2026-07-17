/**
 * Routed-carrier platform prediction (#1569)
 *
 * The generate-label form never names a carrier — fulfillment routing resolves
 * DPD vs InPost server-side at dispatch time. This hook reconstructs that
 * decision on the frontend so the COD currency field can scope to the routed
 * carrier's supported set: it matches the order's source delivery method against
 * the source connection's routing rules, resolves the processor connection, and
 * returns its `platformType`.
 *
 * Returns `undefined` when the carrier can't be predicted — no matching rule,
 * an OMP-fulfilled route (the destination store ships it, no OL carrier), or a
 * processor connection that can't be resolved to a live connection — so callers
 * fall back to the full currency union and let the adapter preflight stay the
 * backstop.
 *
 * @module features/orders/hooks
 */
import { useMemo } from 'react';

import { useConnectionsQuery } from '../../connections';
import { useRoutingRulesQuery } from '../../mappings';

export function useRoutedCarrierPlatform(
  sourceConnectionId: string,
  deliveryMethodId: string | undefined,
  options?: { enabled?: boolean },
): string | undefined {
  const enabled = (options?.enabled ?? true) && Boolean(deliveryMethodId);
  const routingRulesQuery = useRoutingRulesQuery(sourceConnectionId, { enabled });
  // Not `enabled`-gated: connections are cache-warm across the app, so this
  // resolves from cache rather than triggering a fetch on this hook's behalf.
  const connectionsQuery = useConnectionsQuery();

  return useMemo(() => {
    if (!deliveryMethodId) return undefined;
    const rule = (routingRulesQuery.data ?? []).find(
      (r) => r.sourceDeliveryMethodId === deliveryMethodId,
    );
    if (!rule || rule.processorKind === 'omp_fulfilled' || !rule.processorConnectionId) {
      return undefined;
    }
    const processor = (connectionsQuery.data ?? []).find(
      (c) => c.id === rule.processorConnectionId,
    );
    return processor?.platformType;
  }, [deliveryMethodId, routingRulesQuery.data, connectionsQuery.data]);
}
