/**
 * Order Window Reader Capability
 *
 * Optional sub-capability of `OrderSourcePort` (#4228): read the orders of one
 * date window, in a chosen direction, one page at a time, WITHOUT touching the
 * live feed cursor. It backs two operator choices: importing a connection's
 * history newest-first, and a manual "import this date range" run.
 *
 * Why it is separate from `listOrderFeed`: the feed is a forward-only
 * watermark (an event journal on Allegro, a `date_upd` keyset on PrestaShop).
 * A window read has its own opaque cursor, owned by the caller of one import
 * run, so reading history backwards or a bounded range can never move, rewind
 * or block the position that new orders flow through.
 *
 * `from` / `to` are ISO dates (`YYYY-MM-DD`) or ISO instants, already validated
 * by core. A date-only value means the whole day in the shop's own time:
 * `from` starts at 00:00:00 of that day and `to` ends at 23:59:59 of that day
 * (an inclusive range of days). Both are optional: no `from` means "from the
 * beginning of history", no `to` means "up to the newest order". The window is
 * about when the order was PLACED, not when it was last updated.
 *
 * Contract:
 * - `cursor` is opaque and adapter-defined; `null` starts the walk. The result's
 *   `nextCursor` is passed back unchanged for the next page.
 * - `done` is true when the page was the last one. A page may be shorter than
 *   `limit` only when `done` is true.
 * - Pages never overlap and never skip, even when orders are added while the
 *   walk is running (keyset paging, not offsets, where the source allows it).
 * - Items carry the same `eventKey` shape `listOrderFeed` uses, so a window read
 *   and the live feed deduplicate against each other downstream.
 * - It must THROW when the source cannot honour the request (never return an
 *   unfiltered or reordered page): core treats a throw as a failed import job.
 *
 * **Advertised-without-dispatch**, like `OrderFeedBootstrap`: resolved only by
 * narrowing the dispatched `OrderSource` adapter with {@link isOrderWindowReader}.
 * The manifest declares `orderWindowImport: true` so the wizard and the API can
 * offer the choice before any adapter instance exists.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 */
import type { OrderFeedItem } from '../../types/order-feed.types';

export const OrderImportDirectionValues = ['oldest-first', 'newest-first'] as const;
export type OrderImportDirection = (typeof OrderImportDirectionValues)[number];

export interface OrderWindowInput {
  /** First day to include. Omitted: from the beginning of history. */
  from?: string;
  /** Last day to include. Omitted: up to the newest order. */
  to?: string;
  direction: OrderImportDirection;
  /** Opaque position from the previous page, or null to start. */
  cursor: string | null;
  /** Max items per page. */
  limit: number;
}

export interface OrderWindowPage {
  items: OrderFeedItem[];
  /** Pass back as `cursor` for the next page. Null when `done`. */
  nextCursor: string | null;
  done: boolean;
}

export interface OrderWindowReader {
  listOrdersInWindow(input: OrderWindowInput): Promise<OrderWindowPage>;
}

export function isOrderWindowReader<T extends object>(
  adapter: T
): adapter is T & OrderWindowReader {
  const candidate = adapter as Partial<OrderWindowReader>;
  return typeof candidate.listOrdersInWindow === 'function';
}
