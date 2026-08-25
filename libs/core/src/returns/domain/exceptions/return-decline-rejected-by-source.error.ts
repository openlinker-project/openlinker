/**
 * Return Decline Rejected By Source (#2333, ADR-060 / ADR-044)
 *
 * The **neutral** error an adapter raises when the source deterministically
 * refuses OL's request to decline a return — a bad reason code for that source,
 * a return whose state does not permit it, a seller not entitled to the write.
 *
 * It is the returns-context sibling of `MasterProductNotFoundError` (#1599 /
 * #1688): each adapter translates its own platform exception at the port
 * boundary, so no platform exception type reaches core, and core does not have
 * to inspect HTTP status codes it has no business knowing.
 *
 * ## What belongs here, and what must NOT
 *
 * Only a **deterministic refusal** — one that a retry cannot turn into a
 * success. It becomes `order_changes.status = 'declined'` with `declinedReason`
 * carrying `reason`, which is ADR-044's headline benefit: a remote refusal as a
 * first-class, queryable outcome instead of an error swallowed at a call site.
 *
 * A transport failure, a 5xx, a rate limit or an auth failure must stay
 * platform-native and propagate: OL does not know whether the source applied the
 * change, so the proposal must stay OPEN (in-doubt) rather than be recorded as
 * refused. Recording "the marketplace said no" when the request may never have
 * arrived is a claim OL cannot support.
 *
 * A platform "already declined" response is likewise NOT this error — the
 * operator's intent is satisfied, and the adapter resolves it by re-reading the
 * return rather than by failing.
 *
 * @module libs/core/src/returns/domain/exceptions
 */
export class ReturnDeclineRejectedBySourceError extends Error {
  constructor(
    public readonly externalReturnId: string,
    /** The AUTHORITY's own words. Never OL's interpretation of them. */
    public readonly reason: string
  ) {
    super(`Source refused to decline return ${externalReturnId}: ${reason}`);
    this.name = 'ReturnDeclineRejectedBySourceError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ReturnDeclineRejectedBySourceError);
    }
  }
}
