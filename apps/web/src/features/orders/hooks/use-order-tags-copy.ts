/**
 * useOrderTagsCopy
 *
 * The `orders.orderTags` copy for a surface outside the orders feature (the
 * Settings tag manager), so it reads the words without reaching into the
 * `orders` namespace itself.
 *
 * @module apps/web/src/features/orders/hooks
 */
import { useMessages } from '../../../shared/i18n';
import type { OrderTagsCopy } from '../lib/order-tags.types';

export function useOrderTagsCopy(): OrderTagsCopy {
  return useMessages('orders').orderTags;
}
