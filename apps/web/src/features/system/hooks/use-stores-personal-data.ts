/**
 * useStoresPersonalData
 *
 * Thin selector over the system-config query: whether the install stores
 * buyer personal data (`OL_STORE_PII`, #3507 G03-14). With it off, order
 * search indexes only order numbers and SKUs, so copy such as the orders
 * search placeholder must not promise buyer-name or email matches.
 *
 * Returns `undefined` — NOT `false` — while the config is loading, when it
 * failed, or when an older API omits the field. A caller choosing copy should
 * treat `undefined` as "do not claim either way" rather than reading it as
 * either mode, which is why this does not default the way `useDemoMode` does.
 *
 * @module features/system/hooks
 * @see {@link useSystemConfigQuery}
 */
import { useSystemConfigQuery } from './use-system-config-query';

export function useStoresPersonalData(): boolean | undefined {
  const value = useSystemConfigQuery().data?.storesPersonalData;
  return typeof value === 'boolean' ? value : undefined;
}
