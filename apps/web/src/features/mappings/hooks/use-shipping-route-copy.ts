/**
 * useShippingRouteCopy (#3958)
 *
 * The shipping-route wording in the active language. Stable until the
 * language changes, so it is safe as a hook dependency.
 *
 * @module apps/web/src/features/mappings/hooks
 */
import { useMemo } from 'react';
import { useMessages } from '../../../shared/i18n';
import { buildShippingRouteCopy, type ShippingRouteCopy } from '../lib/shipping-route';

export function useShippingRouteCopy(): ShippingRouteCopy {
  const messages = useMessages('mappings').shippingRoute;
  return useMemo(() => buildShippingRouteCopy(messages), [messages]);
}
