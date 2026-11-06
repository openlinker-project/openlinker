/**
 * One order source's shipping coverage (#3958)
 *
 * Reads the same two things the routing editor reads, through the same hooks
 * and therefore the same cache entries: the source's delivery methods and its
 * saved routing rules. Opening the editor for a row costs no second request,
 * and a save there refreshes the count here.
 *
 * @module features/oms-onboarding/hooks
 */
import { useMappingOptions, useRoutingRulesQuery } from '../../mappings';
import { ApiError } from '../../../shared/api/api-error';
import { countRoutedMethods, type SourceShippingCoverage } from '../lib/shipping-coverage';

type MappingOptionKeys = NonNullable<Parameters<typeof useMappingOptions>[1]>;

// Module-level and the same key the routing section asks for, so the set is
// referentially stable and the delivery-methods read is shared with it.
const DELIVERY_METHOD_KEYS: MappingOptionKeys = new Set(['allegroDeliveryMethods'] as const);

export function useSourceShippingCoverage(
  sourceConnectionId: string,
  activeConnectionIds: ReadonlySet<string>
): SourceShippingCoverage {
  const { options, isLoading, errors } = useMappingOptions(sourceConnectionId, DELIVERY_METHOD_KEYS);
  const methodsError = errors.allegroDeliveryMethods;
  // Only a 501 says the source has no delivery-method list; anything else is a
  // read that failed and may work on a retry.
  const cannotList = methodsError instanceof ApiError && methodsError.status === 501;
  const rules = useRoutingRulesQuery(sourceConnectionId, { enabled: methodsError === undefined });

  if (cannotList) return { status: 'cannot-list', withCarrier: 0, total: 0 };
  if (methodsError !== undefined) return { status: 'load-failed', withCarrier: 0, total: 0 };
  if (isLoading || rules.isLoading) return { status: 'loading', withCarrier: 0, total: 0 };

  const methodIds = new Set(options.allegroDeliveryMethods.map((method) => method.value));
  if (rules.error !== null || rules.data === undefined) {
    return { status: 'unknown', withCarrier: 0, total: methodIds.size };
  }
  return {
    status: 'ready',
    withCarrier: countRoutedMethods(methodIds, rules.data, activeConnectionIds),
    total: methodIds.size,
  };
}
