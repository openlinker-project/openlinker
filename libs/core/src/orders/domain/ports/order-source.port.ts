/**
 * Order Source Port
 *
 * Defines the contract for reading orders from external sources. Platform-neutral:
 * implemented by both marketplace adapters (Allegro event feed) and shop adapters
 * (PrestaShop `date_upd` watermark). Order lifecycle management (create, update,
 * cancel) is handled by `OrderProcessorManagerPort`.
 *
 * @module libs/core/src/orders/domain/ports
 * @see {@link OrderProcessorManagerPort} for order lifecycle management
 */

import type { OrderFeedInput, OrderFeedOutput } from '../types/order-feed.types';
import type { IncomingOrder } from '../types/incoming-order.types';

/**
 * Order Source Port
 *
 * Read-only port for fetching orders from external sources.
 *
 * Adapters implementing this port are responsible for:
 * - Fetching incremental order events from the external platform
 * - Transforming external order data to OpenLinker unified `IncomingOrder` schema
 * - Replacing external IDs with internal OpenLinker IDs using `IdentifierMappingService`
 *
 * ## Cursor semantics
 *
 * `fromCursor` / `nextCursor` are opaque adapter-defined strings. The caller
 * persists the value returned by the adapter and replays it unchanged on the
 * next call.
 *
 * - **Allegro**: cursor is the marketplace's event-journal ID (e.g. the last
 *   `event.id` seen in `GET /sale/order-events`).
 * - **PrestaShop**: cursor is a `date_upd` watermark (ISO timestamp of the
 *   most-recently-updated order observed on the previous page).
 * - `null` input cursor means "start from the beginning" (adapter-defined —
 *   often the newest N events, or a reasonable lookback window).
 * - `null` output cursor means "no further pages / no cursor advancement
 *   possible right now".
 */
export interface OrderSourcePort {
  /**
   * List incremental order feed items (event journal).
   *
   * Returns a page of order-event references with a `nextCursor` for
   * continuation. The caller hydrates each reference separately via `getOrder`.
   */
  listOrderFeed(input: OrderFeedInput): Promise<OrderFeedOutput>;

  /**
   * Fetch a full order by source-native external id.
   *
   * Called by `OrderIngestionService` for each feed item to materialize the
   * full `IncomingOrder` payload from the source. Returns internal IDs where
   * possible (products, customer) via `IdentifierMappingService`.
   */
  getOrder(input: { externalOrderId: string }): Promise<IncomingOrder>;
}
