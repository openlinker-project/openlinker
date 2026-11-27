/**
 * Routed-carrier platform prediction (#1569)
 *
 * The generate-label form never names a carrier — fulfillment routing resolves
 * DPD vs InPost server-side at dispatch time. This hook reads that decision so
 * the COD currency field can scope to the routed carrier's supported set: the
 * order's `deliveryResolution` names the processor connection (#3958, instead
 * of re-matching the admin-only routing rules, which an operator cannot read),
 * and this resolves its `platformType`.
 *
 * Returns `undefined` when the carrier can't be predicted — no matching rule,
 * an OMP-fulfilled route (the destination store ships it, no OL carrier), a
 * processor connection that can't be resolved to a live connection, or one whose
 * status is not `active` (a disabled carrier is not a live route, #1799) — so
 * callers fall back to the full currency union and let the adapter preflight
 * stay the backstop.
 *
 * @module features/orders/hooks
 */
import { useMemo } from 'react';

import { useConnectionsQuery } from '../../connections';
import type { OrderDeliveryResolution } from '../api/orders.types';

export function useRoutedCarrierPlatform(
  resolution: OrderDeliveryResolution | null | undefined,
): string | undefined {
  // Connections are cache-warm across the app, so this resolves from cache
  // rather than triggering a fetch on this hook's behalf.
  const connectionsQuery = useConnectionsQuery();
  const processorKind = resolution?.processorKind;
  const processorConnectionId = resolution?.processorConnectionId ?? null;

  return useMemo(() => {
    if (!processorKind || processorKind === 'omp_fulfilled' || !processorConnectionId) {
      return undefined;
    }
    const processor = (connectionsQuery.data ?? []).find((c) => c.id === processorConnectionId);
    // A disabled (non-active) carrier is not a live route (#1799) — don't scope
    // the COD currency field to it; fall back to the full union.
    if (!processor || processor.status !== 'active') {
      return undefined;
    }
    return processor.platformType;
  }, [processorKind, processorConnectionId, connectionsQuery.data]);
}
