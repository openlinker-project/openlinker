/**
 * Shoper Order Parcels Reader
 *
 * The parcels one Shoper order has, read with `filters[order_id]`. Shared by the
 * order processor's fulfilment read-back (#834) and the order source's
 * `OrderFulfillmentReadback` (#3365), so both read the same rows under the same
 * filter-honoured check.
 *
 * A row of ANOTHER order is positive proof the filter was ignored, and every
 * conclusion a caller draws from the rows ("sent", "this is the waybill") would
 * then be about the wrong order, so it throws rather than returning them. The
 * status writeback keeps its own read: it reports the same condition as a
 * `rejected` outcome instead of a throw.
 *
 * @module libs/integrations/shoper/src/infrastructure/readers
 */
import { ShoperNetworkError } from '../../domain/exceptions/shoper-network.error';
import type { ShoperParcel } from '../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../http/shoper-http-client';
import { SHOPER_MAX_PAGE_SIZE } from '../http/shoper-pagination';

export interface ShoperOrderParcels {
  readonly rows: readonly ShoperParcel[];
  /**
   * `false` when Shoper reports more than one page: the read covers the first
   * page only, so a caller listing parcels must not present it as the whole set.
   */
  readonly complete: boolean;
}

export async function readShoperOrderParcels(
  client: ShoperHttpClient,
  externalOrderId: string,
): Promise<ShoperOrderParcels> {
  const { data } = await client.get<{ list?: readonly ShoperParcel[]; pages?: number | string }>('/parcels', {
    'filters[order_id]': externalOrderId,
    limit: SHOPER_MAX_PAGE_SIZE,
  });
  const rows = data.list ?? [];
  if (rows.some((parcel) => String(parcel.order_id) !== externalOrderId)) {
    throw new ShoperNetworkError(
      `Shoper returned parcels of other orders for order ${externalOrderId}; the /parcels filter was not honoured`,
    );
  }
  return { rows, complete: Number(data.pages ?? 1) <= 1 };
}
