/**
 * Routing commit lock + timing (#2395, `W3a-6`, DESIGN §5.3)
 *
 * The lock key, its TTL, and the wall-clock budget the router call is held to.
 *
 * ## Keyed per ORDER, never per (order, router)
 *
 * The invariant being serialized is *"this order is routed once"*. Two operators
 * configuring two different routers for one order is precisely the case a
 * per-connection key would let through, and it is the case that ends in two
 * shipments. Same key shape and the same reasoning as `invoiceIssueLockKey`
 * (#2047) and `shipmentDispatchLockKey` (#1917).
 *
 * ## TTL expiry is not a correctness cliff
 *
 * The window the lock must cover is only guard-read -> `claimIntent`: two
 * database round-trips. Past that point a `live` `routing_decisions` row exists,
 * and a peer's own guard read sees it and refuses — enforced by that table's
 * partial-unique index, not by this lock. So the lock removes the race, and the
 * PERSISTED INTENT ROW is what survives a lock that expired mid-`route()`.
 *
 * That is also why the budget below is strictly less than the TTL rather than
 * merely "generous": a router still running after the lock expired can have its
 * work committed concurrently with a peer that has since acquired the lock. The
 * relationship is asserted by a spec, not left to whoever next edits a default.
 *
 * Resolved ONCE at module load, so both values are fixed for the process
 * lifetime and cannot be varied per-test by mutating `process.env` after import
 * (a spec needing a different value re-imports the module in isolation). That is
 * the `SHIPMENT_DISPATCH_LOCK_TTL_MS` / `INVOICE_ISSUE_LOCK_TTL_MS` precedent,
 * kept deliberately.
 *
 * @module libs/core/src/fulfillment/application/services
 */

const DEFAULT_ROUTE_LOCK_TTL_MS = 120_000;
const MIN_ROUTE_LOCK_TTL_MS = 10_000;
const MAX_ROUTE_LOCK_TTL_MS = 600_000;

/**
 * How much of the TTL the router call may consume.
 *
 * Deliberately a FRACTION rather than an independent env var. Two independently
 * tunable numbers whose only requirement is an inequality is a configuration
 * that can be set into an unsafe state by an operator who has no way to know it;
 * deriving the budget makes `budget < ttl` true by construction at every TTL.
 */
const ROUTE_TIMEOUT_FRACTION_OF_TTL = 0.5;

function resolveRouteLockTtlMs(): number {
  const raw = process.env.OL_FULFILLMENT_ROUTE_LOCK_TTL_MS;
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_ROUTE_LOCK_TTL_MS;
  }

  return Math.min(MAX_ROUTE_LOCK_TTL_MS, Math.max(MIN_ROUTE_LOCK_TTL_MS, parsed));
}

/** TTL of `fulfillment:route:{orderId}`. */
export const FULFILLMENT_ROUTE_LOCK_TTL_MS = resolveRouteLockTtlMs();

/**
 * The declared wall-clock budget for one `FulfillmentRouterPort.route()` call.
 *
 * **Strictly less than {@link FULFILLMENT_ROUTE_LOCK_TTL_MS}** — asserted by a
 * spec, because the inequality is the whole point and a later edit to either
 * default could silently break it.
 */
export const FULFILLMENT_ROUTE_TIMEOUT_MS = Math.floor(
  FULFILLMENT_ROUTE_LOCK_TTL_MS * ROUTE_TIMEOUT_FRACTION_OF_TTL
);

/** `fulfillment:route:{orderId}` — per ORDER, see this file's header. */
export const fulfillmentRouteLockKey = (orderId: string): string =>
  `fulfillment:route:${orderId}`;
