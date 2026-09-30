/**
 * Routed parcel profile hook (#3652)
 *
 * The default parcel (template, box, weight) of the routing rule an order's
 * delivery method matches, for prefilling the generate-label form. Shares the
 * routing-rules query with `useRoutedCarrierPlatform`, so it costs no extra
 * request. `null` while loading, without a matching rule, or without a profile.
 *
 * @module features/orders/hooks
 */
import { useMemo } from 'react';

import { useRoutingRulesQuery } from '../../mappings';
import { parcelPrefillForMethod, type RoutedParcelPrefill } from '../lib/routed-parcel-profile';

export function useRoutedParcelProfile(
  sourceConnectionId: string,
  deliveryMethodId: string | undefined,
): RoutedParcelPrefill | null {
  const query = useRoutingRulesQuery(sourceConnectionId, { enabled: Boolean(deliveryMethodId) });
  return useMemo(
    () => parcelPrefillForMethod(query.data, deliveryMethodId),
    [query.data, deliveryMethodId],
  );
}
