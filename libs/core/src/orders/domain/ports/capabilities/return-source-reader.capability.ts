/**
 * Return Source Reader Capability
 *
 * Read-only, cursor-capable ingestion of **returns** from an order source — a
 * sub-capability of `OrderSourcePort`, not a port of its own. A return is
 * reported by the same relationship, over the same credentials, as the order it
 * refers to, so a second port would have duplicated connection resolution to
 * describe one conversation.
 *
 * **Two methods, and `getReturn` is load-bearing — do not optimise it away.**
 * The obvious reading of a feed + hydrate pair is that the feed detects change
 * and the single-read is a convenience. That is false for the sources this
 * contract was measured against: Allegro's `CustomerReturn` carries `createdAt`
 * but **no `updatedAt`**, and `/order/events` has no return event type at all
 * (SPIKE-2289 E2/E3). So a feed page can only tell a consumer that a return
 * exists — it can never tell it that a known return has moved. Re-reading the id
 * through {@link ReturnSourceReader.getReturn} is therefore the ONLY
 * change-detection channel available, which is why ingestion is two passes: a
 * cursor-paged discovery sweep over the feed, and a bounded re-read sweep over
 * the returns already known to be open. An implementation that collapses the
 * two silently stops observing every transition after creation.
 *
 * {@link IncomingReturn.isTerminalAtSource} is what bounds that second sweep,
 * and is the only derivation from `rawStatus` any layer may make.
 *
 * **Advertised-without-dispatch.** Like `CategoryBrowser` / `OfferCreator` and
 * the rest of the sub-capability family, `ReturnSourceReader` is declared in an
 * adapter manifest's `supportedCapabilities` purely so host-side discovery can
 * tell adapters apart, and is resolved ONLY by narrowing the dispatched
 * `OrderSource` adapter with {@link isReturnSourceReader}. Never call
 * `getCapabilityAdapter(connectionId, 'ReturnSourceReader')` or pass the name to
 * `listCapabilityAdapters` — such a call passes the manifest gate and then fails
 * inside `dispatchCapability` with a generic `Error`, which in the list path
 * aborts the whole listing instead of skipping the connection.
 *
 * The guard is generic over the resolved adapter type (the
 * `isOrderStatusWriteback` precedent) rather than bound to `OrderSourcePort`, so
 * a call site may narrow whatever object it already resolved.
 *
 * No adapter implements this yet; the Allegro implementation, its manifest entry
 * and both ingestion passes land with #2330 in the same wave.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see docs/plans/analysis/SPIKE-2289-allegro-returns-feed.md
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */
import type { IncomingReturn, ReturnFeedInput, ReturnFeedOutput } from '@openlinker/core/returns';

export interface ReturnSourceReader {
  /**
   * List one cursor-paged page of return-feed items. `fromCursor` null starts
   * from the beginning; an empty `items` array — never a count — terminates the
   * sweep, and the caller advances the persisted cursor only once the page has
   * been persisted.
   */
  listReturnFeed(input: ReturnFeedInput): Promise<ReturnFeedOutput>;

  /**
   * Hydrate one full return by its source-native id.
   *
   * This is both the hydration path for a newly discovered return AND the sole
   * change-detection channel for a known one — see the module docblock.
   * Identifier mapping happens downstream in core, never in the adapter.
   */
  getReturn(input: { externalReturnId: string }): Promise<IncomingReturn>;
}

export function isReturnSourceReader<T extends object>(
  adapter: T,
): adapter is T & ReturnSourceReader {
  const candidate = adapter as Partial<ReturnSourceReader>;
  return (
    typeof candidate.listReturnFeed === 'function' && typeof candidate.getReturn === 'function'
  );
}
