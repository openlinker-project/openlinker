/**
 * Order Feed Bootstrap Capability
 *
 * Optional sub-capability of `OrderSourcePort` (#4228): reports where the
 * source's order feed stands RIGHT NOW, so a connection that has never polled
 * can start from "now" instead of importing the source's whole history. Without
 * it, a first poll on a fresh connection reads and enqueues every order the
 * shop ever had.
 *
 * `headCursor()` returns a cursor in the same adapter-defined format
 * `listOrderFeed` emits as `nextCursor`, so core can store it verbatim; `null`
 * means the source has no orders yet. It must THROW on a read failure: core
 * treats a throw as "retry the poll" and never falls back to reading history,
 * since a silent fallback is exactly the full import this exists to prevent.
 *
 * **Advertised-without-dispatch.** Resolved only by narrowing the dispatched
 * `OrderSource` adapter with {@link isOrderFeedBootstrap}; never added to
 * `CoreCapabilityValues` or a manifest, and never requested through
 * `getCapabilityAdapter(connectionId, 'OrderFeedBootstrap')`.
 *
 * The guard probes the method at runtime (the ADR-046 shape) so an adapter that
 * simply lacks it keeps today's behaviour.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 */
export interface OrderFeedBootstrap {
  /** Cursor of the source's newest order, or null when it has none. Throws on failure. */
  headCursor(): Promise<string | null>;
}

export function isOrderFeedBootstrap<T extends object>(
  adapter: T,
): adapter is T & OrderFeedBootstrap {
  const candidate = adapter as Partial<OrderFeedBootstrap>;
  return typeof candidate.headCursor === 'function';
}
