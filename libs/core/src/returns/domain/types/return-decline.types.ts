/**
 * Return Decline Types (#2333, ADR-060 / ADR-044)
 *
 * The neutral command and result of the one return **write** OL performs: ask
 * the source to decline (reject) a customer return's refund.
 *
 * These live in `returns` rather than beside the `ReturnDecliner` capability for
 * the same reason `IncomingReturn` does: the returns vocabulary is owned by the
 * returns context, and a capability file declares its interface and guard, not
 * its data shapes.
 *
 * @module libs/core/src/returns/domain/types
 * @see docs/architecture/adrs/060-returns-aggregate-above-source-projection.md
 */

/**
 * What OL asks the source to do.
 *
 * `reasonCode` is **adapter-native and opaque to core**. Every source that
 * accepts a decline demands a reason from its own closed vocabulary (Allegro's
 * is seven values), and core neither parses one nor picks a default — the
 * alternative would be marketplace vocabulary in `libs/core`, which is the one
 * thing the CORE/Integration boundary exists to prevent. An operator chooses it
 * from the adapter's published {@link ReturnDecliner.declineReasonCodes}.
 *
 * `comment` is operator free text. Some sources require it for some codes
 * (Allegro requires it for `REFUND_REJECTED`); enforcing that is the ADAPTER's
 * job, because only the adapter knows which codes those are.
 */
export interface ReturnDeclineCommand {
  externalReturnId: string;
  reasonCode: string;
  comment: string | null;
}

/**
 * What the source reported back.
 *
 * **`declinedAt` is the SOURCE's own instant, and `null` is a real state, not a
 * gap.** `null` means the source accepted the request but has not yet reported
 * the decline as a fact — the returns product spec's `Decline sent`
 * (§5.6 / US-3: *"a 2xx alone never displays as declined by {source}"*). Core
 * then leaves `ReturnRecord.declinedAt` NULL and does not claim the change's
 * `appliedAt`. There is deliberately **no fallback to OL's clock**: stamping the
 * observation instant would be precisely the assumption ADR-060 forbids.
 *
 * No shipped adapter reaches that state — Allegro's success body carries
 * `rejection.createdAt` — and the reconciler that would later stamp it from a
 * feed observation is Wave 2's (#2372 / #2377). The gap is named rather than
 * papered over.
 */
export interface ReturnDeclineResult {
  declinedAt: Date | null;
  /** The source's own status word after the write, verbatim. Never interpreted. */
  rawStatus: string | null;
  /** The source's raw response, for debugging. Never branched on. */
  raw?: unknown;
}
