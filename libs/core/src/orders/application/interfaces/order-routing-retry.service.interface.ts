/**
 * Order Routing Retry Service Interface (#3558, epic #3511)
 *
 * The two ways an order OpenLinker is HOLDING because routing could not place it
 * is routed again before `fulfillment.work.rerouteSweep`'s next tick: an
 * operator's "Retry routing", and a stock change for a variant the order is
 * waiting on.
 *
 * Both only ENQUEUE `fulfillment.work.route`. That job re-reads the stored
 * snapshot, calls the exactly-once `route()` commit (#2395) and persists the new
 * block (or clears it) through the same `deriveRoutingHoldOutcome` rule the
 * ingestion intercept and the sweep use. So "no duplicate `routing_decisions`
 * row" and "the hold clears on success" are inherited, not re-implemented here.
 *
 * ## Properties that are load-bearing
 *
 * 1. **Neither method throws for a modelled condition.** Every modelled failure
 *    leaves by the result union, and the stock trigger is called from the
 *    inventory propagation path, where a throw would fail a stock write-back.
 * 2. **Failures carry a CODE, never the caught message** (the #2341 rule): an
 *    enqueue failure comes from Redis / Postgres and its message can carry a host
 *    or a credential fragment.
 * 3. **The retry key is fresh per click.** The first key of any family is
 *    permanent in `sync_jobs.idempotencyKey`, so a second operator click under a
 *    stable key would silently dedup against the first.
 * 4. **The stock trigger is bounded by a per-hour key**, because every route
 *    attempt mints a durable `routing_decisions` row that nothing prunes. An
 *    order stuck on a hot SKU would otherwise mint one per stock write.
 *
 * @module libs/core/src/orders/application/interfaces
 */

/** Why an operator retry did not enqueue. */
export const OrderRoutingRetryRefusalValues = [
  /** The order is not held at all (routed, mirrored, or never held). */
  'not-held',
  /**
   * Held for a reason a retry cannot change: a missing shipping address (only a
   * re-ingestion supplies one) or one of the self-resolving guards.
   */
  'not-retryable',
  /** No single router is selected, so nothing could route the order. */
  'no-router',
] as const;

export type OrderRoutingRetryRefusal = (typeof OrderRoutingRetryRefusalValues)[number];

export type OrderRoutingRetryResult =
  | { status: 'enqueued'; jobId: string }
  | { status: 'refused'; reason: OrderRoutingRetryRefusal }
  | { status: 'order-not-found' }
  | { status: 'enqueue-failed' };

export interface RerouteHeldOrdersForVariantInput {
  /** The variant whose stock just changed. */
  variantId: string;
  /**
   * The inventory row's write stamp, when the job carried one. Used only to
   * name the attempt in logs; the dedupe key is the UTC hour, never the stamp.
   */
  observedAt?: string | null;
}

export interface RerouteHeldOrdersResult {
  /** Held orders found for the variant (a page, at most the service's bound). */
  readonly candidates: number;
  /** Route jobs actually enqueued (the rest were deduped or failed). */
  readonly enqueued: number;
}

export interface IOrderRoutingRetryService {
  /** Operator "Retry routing" for one held order. */
  retryRouting(internalOrderId: string): Promise<OrderRoutingRetryResult>;

  /**
   * Re-route the held orders waiting on a variant whose stock changed.
   * Best-effort: never throws, and returns zero counts on any failure.
   */
  rerouteHeldOrdersForVariant(
    input: RerouteHeldOrdersForVariantInput
  ): Promise<RerouteHeldOrdersResult>;
}
