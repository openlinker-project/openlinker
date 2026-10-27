/**
 * Shoper Order Feed Types
 *
 * The state the order feed carries between polls. Core stores it as one opaque
 * string (`OrderFeedOutput.nextCursor`); the adapter encodes two passes in it:
 *
 *   - the `order_id` keyset that discovers NEW orders, and
 *   - a `status_date` watermark that re-observes orders whose status changed
 *     after they were read, which an id keyset can never see.
 *
 * Timestamps are Shoper's own naive, shop-local `YYYY-MM-DD HH:MM:SS`: they are
 * only compared with and sent back to the same shop, never turned into instants.
 *
 * @module libs/integrations/shoper/src/domain/types
 */
import type { OrderFeedItem } from '@openlinker/core/orders';

export interface ShoperOrderFeedCursor {
  /** Highest `order_id` the new-orders pass has read; null before the first one. */
  readonly lastOrderId: string | null;
  /**
   * Highest `status_date` the status pass has read. Null when no pass has run yet
   * (first poll, or a cursor written before the status pass existed): the next
   * poll then stamps it from the shop and re-reads nothing older.
   */
  readonly statusWatermark: string | null;
  /**
   * A status pass that did not fit in one poll: the `status_date >=` bound it
   * reads with and the next page to read. Both null between passes; kept fixed
   * across polls so a resumed pass reads the same result set.
   */
  readonly statusPassStart: string | null;
  readonly statusNextPage: number | null;
}

/** The status-pass half of the cursor, as one poll leaves it. */
export type ShoperStatusPassState = Pick<
  ShoperOrderFeedCursor,
  'statusWatermark' | 'statusPassStart' | 'statusNextPage'
>;

export interface ShoperStatusPassResult {
  readonly items: OrderFeedItem[];
  readonly cursor: ShoperStatusPassState;
}
