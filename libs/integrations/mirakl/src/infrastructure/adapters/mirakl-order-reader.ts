/**
 * Mirakl Order Reader
 *
 * Reads one order through OR11 (`GET /api/orders?order_ids=`), the only way
 * the Seller API exposes a single order. Shared by the order source, the
 * status writeback and the fulfilment readback, so all three see the order
 * the same way.
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters
 */
import type { MiraklOrder, MiraklOrdersPage } from '../../domain/types/mirakl-order.types';
import type { IMiraklHttpClient } from '../http/mirakl-http-client.interface';

export const MIRAKL_ORDERS_PATH = '/api/orders';

/** The order, or `null` when Mirakl does not list it for this shop. */
export async function readMiraklOrder(
  httpClient: IMiraklHttpClient,
  orderId: string
): Promise<MiraklOrder | null> {
  const { data } = await httpClient.get<MiraklOrdersPage>(MIRAKL_ORDERS_PATH, {
    queryParams: { order_ids: orderId },
  });
  return (data?.orders ?? []).find((candidate) => candidate.order_id === orderId) ?? null;
}

/** An order path segment; Mirakl order ids carry a dash and a letter (`1001-A`). */
export function miraklOrderPath(orderId: string, action: string): string {
  return `${MIRAKL_ORDERS_PATH}/${encodeURIComponent(orderId)}/${action}`;
}

/** A Mirakl failure as one safe sentence: status and code, never the body. */
export function describeMiraklFailure(statusCode?: number, miraklCode?: string): string {
  const status = statusCode !== undefined ? ` (${statusCode})` : '';
  return miraklCode ? `${miraklCode}${status}` : `HTTP${status || ' error'}`;
}
