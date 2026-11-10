/**
 * Routed parcel profile hook (#3652)
 *
 * The default parcel (template, box, weight) of the routing rule an order's
 * delivery method matches, for prefilling the generate-label form. Read from
 * the order's own `deliveryResolution.parcelProfile` (#3958) rather than the
 * routing-rules endpoint: that endpoint is admin-only, so for an operator the
 * request was refused and the prefill silently went missing. `null` without a
 * matching rule or without a profile.
 *
 * @module features/orders/hooks
 */
import { useMemo } from 'react';

import type { OrderDeliveryResolution } from '../api/orders.types';
import { parcelPrefillFromFields, type RoutedParcelPrefill } from '../lib/routed-parcel-profile';

export function useRoutedParcelProfile(
  resolution: OrderDeliveryResolution | null | undefined,
): RoutedParcelPrefill | null {
  const profile = resolution?.parcelProfile;
  // Memoised on the profile object: the label form re-applies the prefill when
  // this value changes identity, and the query keeps an unchanged profile's
  // identity across refetches.
  return useMemo(() => parcelPrefillFromFields(profile), [profile]);
}
