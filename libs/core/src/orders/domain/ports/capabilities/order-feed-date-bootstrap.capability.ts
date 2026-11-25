/**
 * Order Feed Date Bootstrap Capability
 *
 * Optional sub-capability of `OrderSourcePort` (#4228), the sibling of
 * `OrderFeedBootstrap`: where `headCursor()` answers "where does the feed stand
 * now", `cursorForDate(date)` answers "where does the feed stand at the START of
 * this date". It lets an operator who chose "from {date}" when creating a
 * connection import only the orders since then.
 *
 * `date` is an ISO date (`YYYY-MM-DD`) or ISO instant, already validated by core.
 * The result is a cursor in the same adapter-defined format `listOrderFeed`
 * emits as `nextCursor`, so core stores it verbatim. It must THROW when the
 * source cannot honour a date (never return a cursor that silently means "all"
 * or "now"): core treats a throw as "retry the poll", which keeps the operator's
 * choice visible as a failing job instead of a quietly wrong import.
 *
 * **Advertised-without-dispatch**, like `OrderFeedBootstrap`: resolved only by
 * narrowing the dispatched `OrderSource` adapter with
 * {@link isOrderFeedDateBootstrap}, never a manifest capability. The manifest
 * instead declares `orderSyncStartModes` so create-time validation needs no
 * adapter instance.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 */
export interface OrderFeedDateBootstrap {
  /** Cursor at the start of `date`. Throws when the source cannot honour a date. */
  cursorForDate(date: string): Promise<string>;
}

export function isOrderFeedDateBootstrap<T extends object>(
  adapter: T
): adapter is T & OrderFeedDateBootstrap {
  const candidate = adapter as Partial<OrderFeedDateBootstrap>;
  return typeof candidate.cursorForDate === 'function';
}
