/**
 * Order line costs hook (#3588, D27, mockup M30 `order-line`)
 *
 * The cost columns are shown only to a session that may read orders AND is not
 * a packer (a packer holds `bench:write` alone, so `orders:read` excludes it;
 * the route refuses it too), and only while the operator has not switched margin
 * off. `status` separates "not loaded yet / failed" from "loaded" so a column
 * never shows a guessed number.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usePermission } from '../../../shared/auth/use-permission';
import { useTrackMargin } from '../../analytics';
import { ordersQueryKeys } from '../api/orders.query-keys';
import type { OrderLineCost } from '../api/orders.types';

export interface OrderLineCostsState {
  /** Whether the cost columns render at all. */
  enabled: boolean;
  /** `loaded` only once the read answered; otherwise cells show the empty marker. */
  status: 'loading' | 'error' | 'loaded';
  currency: string | null;
  lines: OrderLineCost[];
}

export function useOrderLineCosts(internalOrderId: string | undefined): OrderLineCostsState {
  const apiClient = useApiClient();
  const canRead = usePermission('orders:read');
  const trackMargin = useTrackMargin();
  const enabled = Boolean(internalOrderId) && canRead && trackMargin;

  const query = useQuery({
    queryKey: ordersQueryKeys.lineCosts(internalOrderId ?? ''),
    queryFn: () => apiClient.orders.listLineCosts(internalOrderId as string),
    enabled,
  });

  return {
    enabled,
    status: query.isError ? 'error' : query.data ? 'loaded' : 'loading',
    currency: query.data?.currency ?? null,
    lines: query.data?.lines ?? [],
  };
}
