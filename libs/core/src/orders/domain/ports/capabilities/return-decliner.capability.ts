/**
 * Return Decliner Capability (#2333, ADR-060 / ADR-044)
 *
 * The one return **write** in scope: ask the source to decline (reject) a
 * customer return's refund. A sub-capability of `OrderSourcePort`, sitting
 * beside its read-only sibling `ReturnSourceReader`.
 *
 * ## Why this is not a method on `ReturnSourceReader`
 *
 * #2333 left the choice open; it is resolved here, in favour of a dedicated
 * capability. `ReturnSourceReader`'s contract opens with "Read-only,
 * cursor-capable ingestion of returns", and its guard tests exactly its two read
 * methods. Adding a write would falsify that sentence, would oblige every
 * present and future implementer to grow a write it may not have (Erli mints no
 * return id and publishes no rejection endpoint at all), and would force the
 * guard either to grow a third method test — silently reclassifying an adapter
 * compiled against the older shape as no longer a reader — or to stop meaning
 * what it says. One capability per method-set is the family's rule; this is that
 * rule applied.
 *
 * ## Advertised-without-dispatch
 *
 * Like `CategoryBrowser` / `OfferCreator` / `ReturnSourceReader`, this name is
 * declared in an adapter manifest's `supportedCapabilities` purely for host-side
 * discovery, and is resolved ONLY by narrowing the dispatched `OrderSource`
 * adapter with {@link isReturnDecliner}. Never call
 * `getCapabilityAdapter(connectionId, 'ReturnDecliner')` or pass the name to
 * `listCapabilityAdapters`: such a call passes the manifest gate and then fails
 * inside `dispatchCapability` with a generic `Error`, which in the list path
 * aborts the whole listing instead of skipping the connection. It is likewise
 * **not** a `CoreCapabilityValues` member — that closed list is pinned by a spec
 * and is `@IsIn`-validated on both connection DTOs, so an
 * advertised-without-dispatch name there would be both wrong and unwritable.
 *
 * The guard is generic over the resolved adapter type (the
 * `isOrderStatusWriteback` / `isReturnSourceReader` precedent) so a call site
 * may narrow whatever object it already resolved.
 *
 * @module libs/core/src/orders/domain/ports/capabilities
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */
import type {
  ReturnDeclineCommand,
  ReturnDeclineResult,
} from '@openlinker/core/returns';

export interface ReturnDecliner {
  /**
   * Ask the source to decline a customer return's refund.
   *
   * The result's `declinedAt` must be the SOURCE's own instant, or `null` where
   * the source accepted the request without reporting the decline as a fact —
   * see {@link ReturnDeclineResult}. An adapter must never substitute its own
   * clock: core stamps `ReturnRecord.declinedAt` from this value alone, and a
   * fabricated instant would make an OL-authored guess indistinguishable from a
   * marketplace observation.
   *
   * An adapter SHOULD treat a platform "already declined" response as a success
   * — re-reading the return to recover the real instant — rather than as a
   * failure: the operator's intent is satisfied, and reporting an error would
   * make a retry permanently red on a return that is in fact declined.
   */
  declineReturn(command: ReturnDeclineCommand): Promise<ReturnDeclineResult>;

  /**
   * OPTIONAL: the source's own reason-code vocabulary, so an operator surface
   * can offer a choice rather than making one up.
   *
   * **Core treats it as an OPAQUE list and never interprets a member** — the
   * `ReturnSourceReader.terminalRawStatuses` contract, for the same reason: the
   * source's language stays adapter-side.
   *
   * Optional on purpose, and the guard is unchanged — {@link isReturnDecliner}
   * keys on the METHOD only, so an adapter that publishes no stable vocabulary
   * is still a full `ReturnDecliner`.
   */
  readonly declineReasonCodes?: readonly string[];
}

export function isReturnDecliner<T extends object>(
  adapter: T
): adapter is T & ReturnDecliner {
  const candidate = adapter as Partial<ReturnDecliner>;
  return typeof candidate.declineReturn === 'function';
}
