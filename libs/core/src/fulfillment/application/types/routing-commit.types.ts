/**
 * Routing commit I/O (#2395, `W3a-6`, ADR-054 R1, DESIGN §5.3)
 *
 * What the host hands the routing commit, and every way that commit can end.
 *
 * ## Everything crosses as an ARGUMENT
 *
 * `router`, `lock` and `isCancelled` are parameters rather than injected
 * dependencies because `fulfillment` is a registered zero-sibling-edge leaf:
 * ADR-053's no-injection invariant forbids this context injecting `orders`,
 * `integrations` or `sync`, and `barrel-purity.spec.ts` enforces it. The host
 * composes them — the same shape #2399's `FulfillmentHandshakeService` already
 * takes for its `executor`.
 *
 * @module libs/core/src/fulfillment/application/types
 */
import type { FulfillmentRouterPort } from '../../domain/ports/fulfillment-router.port';
import type { RoutingLockPort } from '../../domain/ports/routing-lock.port';
import type { RoutingDecisionAbandonReason } from '../../domain/types/routing-decision.types';
import type { RoutingInputLine } from '../../domain/types/routing.types';
import type { RoutingShipTo } from '../../domain/types/routing-ship-to.types';

export interface RouteOrderInput {
  readonly orderId: string;
  /** The single router selection resolved upstream by `selectPrimaryFulfillmentRouter`. */
  readonly routerConnectionId: string;
  readonly lines: readonly RoutingInputLine[];
  readonly shipTo: RoutingShipTo;
  readonly requestedDeliveryMethod: string | null;

  readonly router: FulfillmentRouterPort;
  readonly lock: RoutingLockPort;

  /**
   * Whether the order is cancelled, read **inside** the lock.
   *
   * A callback rather than a scalar, and that is the whole point. A boolean
   * resolved by the host before the lock is a value read at a moment that has
   * already passed: the window a cancellation can slip through is
   * read -> acquire, so re-checking a stale copy inside the lock closes nothing
   * and merely looks like it does. Re-reading here makes the check mean what it
   * says (REVIEW C10).
   */
  readonly isCancelled: () => Promise<boolean>;
}

/**
 * How a routing commit ended.
 *
 * Enumerated as a closed union rather than a boolean plus a nullable reason, so
 * a caller must handle every arm and a new arm is a compile error at every call
 * site.
 */
export type RoutingCommitOutcome =
  /** N work rows and the decision's terminalisation committed together. */
  | { readonly status: 'routed'; readonly decisionId: string; readonly workIds: readonly string[] }
  /**
   * Nothing was attempted and nothing was written.
   *
   * `already-routed` and `already-live-elsewhere` are the #2047 write-path
   * guard refusing **regardless of router identity**.
   */
  | {
      readonly status: 'skipped';
      readonly reason: 'order-cancelled' | 'already-routed' | 'already-live-elsewhere';
    }
  /**
   * A peer holds the lock. Answered from persisted state only — the router was
   * NOT called, so a contended attempt can never produce a second plan.
   */
  | { readonly status: 'contended' }
  /** The router answered and OpenLinker refused the answer. Decision terminal. */
  | {
      readonly status: 'refused';
      readonly decisionId: string;
      readonly reason: RoutingDecisionAbandonReason;
    }
  /**
   * The router may or may not have committed on its side.
   *
   * **The decision row is deliberately left `live`.** See `RoutingCommitService`
   * — this is the arm whose handling is the finding of #2395.
   */
  | {
      readonly status: 'in-doubt';
      readonly decisionId: string;
      readonly cause: 'timeout' | 'error';
    };
