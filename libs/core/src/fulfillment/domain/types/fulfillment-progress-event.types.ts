/**
 * Fulfillment Progress Event Vocabulary (#2400, ADR-054, DESIGN §5.4/§5.5)
 *
 * What an executor can tell OpenLinker about work it is holding, and what
 * OpenLinker answers back.
 *
 * ## Every event carries a mandatory, vendor-scoped `idempotencyKey`
 *
 * Mandatory rather than optional because the dedup is the whole point: an
 * optional key would make the ONE guarantee this seam exists to provide
 * silently unavailable exactly when a caller forgot to supply it, and a replay
 * would then re-move counters. `?:` here would be a footgun with no upside.
 *
 * It is **the vendor's key**, and is distinct from both of the other two
 * idempotency keys in play, which are deliberately not reused:
 *
 *  - `FulfillmentRequest.idempotencyKey` (`work:{workId}:{assignmentAttempt}`)
 *    identifies an OUTBOUND request OL made. Different direction.
 *  - `buildInboundJobIdempotencyKey(platformType, connectionId, sourceEventId)`
 *    dedups the JOB at the ingress. That is one delivery; this is one reported
 *    progress fact, and a single delivery may legitimately be retried into
 *    several job attempts.
 *
 * ## Three kinds are indistinguishable in persisted state
 *
 * `FulfillmentWorkStatusValues` has no `packed` or `shipped` member, so `picked`
 * and `packed` both land on `in_progress` and `shipped` writes no status at all.
 * Only the `eventKind` stamped on the (burnt) claim row records which arrived.
 * That is a real consequence for a consumer reading the work object back: it can
 * see that work is in progress, not how far.
 *
 * ## `awaiting_wave` is deliberately absent
 *
 * It is the named first extension point, not an oversight. Waving needs a
 * claim/release entity that does not exist, and ADR-045's `packGrain` lesson is
 * that shipping a grain you cannot yet honour is worse than not shipping it:
 * consumers write code against a value the system cannot actually reach, and
 * the debt is paid by whoever discovers that later.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.4
 */

/**
 * One member per line, no computed keys — the mirror-script family reads these
 * arrays TEXTUALLY (`scripts/check-*-mirror.mjs`), so a `.map()` or a spread
 * would defeat a future mirror before it is written.
 */
export const FulfillmentProgressEventKindValues = [
  /** Units were picked against one line. Moves `fulfilledQuantity`. */
  'picked',
  /**
   * The holder picked fewer units than asked and will not pick the rest.
   * Moves `fulfilledQuantity` for what was picked AND `cancelledQuantity` for
   * the shortfall, then closes the work `incomplete`.
   *
   * **Re-entering `route()` for the shortfall is NOT this context's to do** —
   * it needs #2395's router and the routing lock, and reading `order.cancelledAt`
   * needs `@openlinker/core/orders`, which ADR-053's no-injection invariant
   * forbids here. It is reported as a `reroute` INTENT instead; #2401 composes it.
   */
  'short_picked',
  /** Everything picked is packed. Execution axis only; moves no counters. */
  'packed',
  /** The parcel left the holder. Execution axis only. */
  'shipped',
  /** The holder considers the work finished. Terminal on the execution axis. */
  'closed',
] as const;

export type FulfillmentProgressEventKind = (typeof FulfillmentProgressEventKindValues)[number];

/** Fields every progress event carries, whatever its kind. */
interface FulfillmentProgressEventBase {
  /**
   * The OL-internal work id. An INTERNAL id, entering as an argument — ADR-053's
   * "order data enters as ARGUMENTS" discipline, the same reason
   * `FulfillmentWork.orderId` is a plain string and not an `Order`.
   *
   * Resolving a vendor's own reference to this id is **#2399's**, which owns the
   * executor handshake and therefore knows whether that reference is
   * per-connection (mapping-shaped) or intrinsic to the row (column-shaped).
   */
  readonly workId: string;
  /** The executor connection reporting the progress. */
  readonly connectionId: string;
  /** Vendor-scoped dedup key. See the module docblock — mandatory on purpose. */
  readonly idempotencyKey: string;
  /** When the executor says it happened. */
  readonly occurredAt: Date;
}

/** Units moved against one order line. */
export interface FulfillmentProgressLineDelta {
  readonly orderLineId: string;
  /** Units newly picked. Never negative — progress is monotonic. */
  readonly fulfilledDelta: number;
  /** Units the holder will not pick. Never negative. */
  readonly cancelledDelta: number;
}

export interface FulfillmentPickedEvent extends FulfillmentProgressEventBase {
  readonly kind: 'picked';
  readonly lines: readonly FulfillmentProgressLineDelta[];
}

export interface FulfillmentShortPickedEvent extends FulfillmentProgressEventBase {
  readonly kind: 'short_picked';
  readonly lines: readonly FulfillmentProgressLineDelta[];
}

export interface FulfillmentPackedEvent extends FulfillmentProgressEventBase {
  readonly kind: 'packed';
}

export interface FulfillmentShippedEvent extends FulfillmentProgressEventBase {
  readonly kind: 'shipped';
}

export interface FulfillmentClosedEvent extends FulfillmentProgressEventBase {
  readonly kind: 'closed';
}

export type FulfillmentProgressEvent =
  | FulfillmentPickedEvent
  | FulfillmentShortPickedEvent
  | FulfillmentPackedEvent
  | FulfillmentShippedEvent
  | FulfillmentClosedEvent;

/**
 * Something a caller OUTSIDE this context must do as a consequence of recorded
 * progress — reported, never performed.
 *
 * This is ADR-053's report-don't-perform seam and the #2100
 * `SalesDocumentBlockOutcome` shape. Performing any of these means importing
 * `@openlinker/core/orders`, which `scripts/check-no-injection-contracts.mjs`
 * and `barrel-purity.spec.ts` independently forbid under this directory — and
 * that prohibition is the design, not an obstacle to route around.
 *
 * **Nothing consumes these yet.** #2401 owns the relay and is the first
 * consumer; it also brings the already-built `claimDispatchRelay` (#2392,
 * `WHERE "dispatchRelayedAt" IS NULL`) into use and adds its
 * `releaseDispatchRelay` counterpart.
 */
export type FulfillmentRelayIntent =
  | {
      /** Tell the order's source the work dispatched. Gated by `claimDispatchRelay`. */
      readonly kind: 'dispatch';
      readonly workId: string;
    }
  | {
      /**
       * Re-source the shortfall with the rejecting holder blocked (DESIGN §5.5).
       * The caller must take the routing lock and check the order carries no
       * `cancelledAt` — both facts live outside this context.
       */
      readonly kind: 'reroute';
      readonly workId: string;
      readonly blockedHolderId: string | null;
    };

/**
 * What `record()` answers. Four statuses, each a real, distinguishable fact.
 *
 * There is no throw on any of them: `FulfillmentWorkRepositoryPort`'s guarded
 * updates answer `false` for "the precondition no longer held", which that port
 * documents as *"an ordinary outcome, not an error"*, and turning an expected
 * race into an exception would force every caller into catch-as-control-flow.
 */
export type FulfillmentProgressOutcome =
  /** Applied. `intents` may be empty; an empty list is not a failure. */
  | { readonly status: 'recorded'; readonly intents: readonly FulfillmentRelayIntent[] }
  /**
   * This `(workId, idempotencyKey)` was already recorded. Nothing was written
   * and NO intent is returned — re-emitting one would re-fire a relay, which is
   * the replay defect the claim exists to close.
   */
  | { readonly status: 'duplicate' }
  /** No such work row. Named rather than silent, and never a throw. */
  | { readonly status: 'unknown-work'; readonly workId: string }
  /**
   * A guarded update found its precondition gone.
   *
   * **This does NOT mean nothing was written, and the difference matters.**
   * `applyLineDeltas` issues one guarded UPDATE PER LINE with no transaction
   * around them, and the claim is burnt before the first one. So an event over
   * several lines whose second line is refused leaves the FIRST line's counter
   * permanently moved; `short_picked` has the same shape one level up, where
   * the deltas land and a refused `transitionStatus` then leaves the work not
   * closed `incomplete`. Because the claim is already burnt, a retry under the
   * same key answers `duplicate` — so the partial write is permanent and the
   * reporter believes it was handled.
   *
   * Closing this needs a transaction spanning the per-line updates, and
   * `FulfillmentWorkRepositoryPort` deliberately offers none today ("the axis
   * transitions open no transaction and accept none"); widening that seam is
   * **#2395's**. It cannot bite while `record()` has no production caller, which
   * is precisely why it is written down here rather than left to be rediscovered
   * — **#2398 is the issue that makes it reachable**, the moment its poller
   * becomes the first caller.
   */
  | { readonly status: 'precondition-failed'; readonly reason: string };
