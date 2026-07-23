/**
 * Mapping Options Hook
 *
 * Fetches all 6 dropdown option lists in parallel for a given connection.
 * Returns a combined MappingOptions bundle plus loading state and a per-bundle
 * error record. Failures are isolated per bundle key (#484): if Allegro
 * payment-providers fail, the operator can still configure Order Statuses and
 * Carriers — only the affected panel renders an inline error.
 *
 * Each query has its own (side, kind) key so a single panel's options can
 * be invalidated independently when needed.
 *
 * @module apps/web/src/features/mappings/hooks
 */

import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mappingsQueryKeys } from '../api/mappings.query-keys';
import type { MappingOptions, MappingSide, MappingOptionListKind } from '../api/mappings.types';

export type MappingOptionsErrors = Partial<Record<keyof MappingOptions, Error>>;

interface UseMappingOptionsResult {
  options: MappingOptions;
  isLoading: boolean;
  errors: MappingOptionsErrors;
}

const EMPTY_OPTIONS: MappingOptions = {
  allegroOrderStatuses: [],
  allegroDeliveryMethods: [],
  allegroPaymentProviders: [],
  prestashopOrderStatuses: [],
  prestashopCarriers: [],
  prestashopPaymentModules: [],
};

const QUERY_SPEC: Array<{
  side: MappingSide;
  kind: MappingOptionListKind;
  bundleKey: keyof MappingOptions;
}> = [
  { side: 'source', kind: 'order-statuses', bundleKey: 'allegroOrderStatuses' },
  { side: 'source', kind: 'delivery-methods', bundleKey: 'allegroDeliveryMethods' },
  { side: 'source', kind: 'payment-methods', bundleKey: 'allegroPaymentProviders' },
  { side: 'destination', kind: 'order-statuses', bundleKey: 'prestashopOrderStatuses' },
  { side: 'destination', kind: 'carriers', bundleKey: 'prestashopCarriers' },
  { side: 'destination', kind: 'payment-methods', bundleKey: 'prestashopPaymentModules' },
];

/**
 * Per-side connection ids. Mapping data is keyed to DIFFERENT sides (#1784
 * follow-up B1): source-side option lists come from the marketplace connection,
 * destination-side lists from its paired master shop. Callers that don't care
 * (e.g. the PrestaShop structured-config carrier picker) may pass a single
 * string, which is used for both sides.
 */
export type MappingOptionsConnectionIds = string | { source: string; destination: string };

/**
 * Option dictionaries are near-static; refetching against slow destination-shop
 * endpoints on every remount/refocus is wasteful (#1784 follow-up). A large but
 * finite staleTime keeps them fresh-per-session without pinning them forever in
 * memory across a genuinely stale session (S10).
 */
const OPTIONS_STALE_TIME_MS = 10 * 60 * 1000;

export function useMappingOptions(
  connectionIds: MappingOptionsConnectionIds,
  /**
   * Which bundle keys to actually fetch (#1784 follow-up: lazy-load per tab).
   * A key absent from the set has its query disabled, so option lists are
   * fetched only for the tab(s) the operator has visited. `undefined` keeps
   * the original "fetch all" behaviour for any caller that doesn't opt in.
   */
  enabledKeys?: ReadonlySet<keyof MappingOptions>,
): UseMappingOptionsResult {
  const apiClient = useApiClient();

  const sourceConnectionId =
    typeof connectionIds === 'string' ? connectionIds : connectionIds.source;
  const destinationConnectionId =
    typeof connectionIds === 'string' ? connectionIds : connectionIds.destination;

  const results = useQueries({
    queries: QUERY_SPEC.map(({ side, kind, bundleKey }) => {
      const connectionId = side === 'source' ? sourceConnectionId : destinationConnectionId;
      return {
        enabled: connectionId.length > 0 && (enabledKeys?.has(bundleKey) ?? true),
        staleTime: OPTIONS_STALE_TIME_MS,
        gcTime: 60 * 60 * 1000,
        queryKey: mappingsQueryKeys.option(connectionId, side, kind),
        queryFn: () => apiClient.mappings.getMappingOptions(connectionId, side, kind),
      };
    }),
  });

  const isLoading = results.some((r) => r.isLoading);
  const options: MappingOptions = { ...EMPTY_OPTIONS };
  const errors: MappingOptionsErrors = {};
  results.forEach((result, index) => {
    const { bundleKey } = QUERY_SPEC[index];
    options[bundleKey] = result.data ?? [];
    if (result.error instanceof Error) {
      errors[bundleKey] = result.error;
    }
  });

  return { options, isLoading, errors };
}
