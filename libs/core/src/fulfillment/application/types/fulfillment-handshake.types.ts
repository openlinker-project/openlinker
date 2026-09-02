/**
 * Fulfilment handshake I/O (#2399, `W3a-10`)
 *
 * What the negotiation axis is asked to do, and what it answers.
 *
 * ## The executor arrives as an ARGUMENT, and that is architectural
 *
 * `fulfillment` is a registered zero-sibling-edge leaf, so the service may not
 * inject `IIntegrationsService` to resolve the adapter — that is a VALUE import
 * from a sibling context and `barrel-purity.spec.ts` refuses it. Nor may it read
 * the order for a ship-to: ADR-053's no-injection invariant forbids it outright.
 *
 * Both therefore enter as arguments, which is ADR-053's own rule ("order data
 * enters as arguments") applied to a second kind of dependency rather than a way
 * around it. The host (`apps/worker`) already composes `IIntegrationsService`,
 * so resolution belongs there. A useful consequence: the service unit-tests
 * against a hand-rolled `FulfillmentExecutorPort` with no Nest module at all.
 *
 * `deliveryMethod` is deliberately NOT here. It is already a persisted column on
 * the work row, written insert-only by the router; passing it as a second source
 * would let a caller's value disagree with the row's, and
 * `FulfillmentRequest.deliveryMethod` would then carry a fact the work object
 * contradicts. The service reads it from the work it already loaded.
 *
 * @module libs/core/src/fulfillment/application/types
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import type { FulfillmentCancellationReason } from '@openlinker/core/fulfillment-authority';
import type { FulfillmentExecutorPort } from '../../domain/ports/fulfillment-executor.port';
import type { RoutingShipTo } from '../../domain/types/routing-ship-to.types';

export interface DispatchFulfillmentWorkInput {
  readonly workId: string;
  /**
   * The attempt this job was enqueued for, or `null` for the first dispatch.
   *
   * Load-bearing: it scopes the RESUME path. A delayed duplicate job for attempt
   * 1 that wakes after a router-driven re-request would otherwise find the work
   * `submitted` at attempt 2 and resume on it — minting a key it never claimed,
   * for a holder it was not enqueued against.
   */
  readonly expectedAssignmentAttempt: number | null;
  readonly shipTo: RoutingShipTo;
  /** Resolved by the HOST. See this file's header. */
  readonly executor: FulfillmentExecutorPort;
}

export interface RequestFulfillmentCancellationInput {
  readonly workId: string;
  readonly reason: FulfillmentCancellationReason;
  /** Resolved by the HOST. See this file's header. */
  readonly executor: FulfillmentExecutorPort;
}

/**
 * What the handshake did.
 *
 * `no-op` is not a failure and not a success-with-effect: it is the honest
 * answer for a work already past the state this call addresses (accepted,
 * terminal, or an attempt this job was not enqueued for). It exists as its own
 * member so a caller cannot confuse "we accepted" with "somebody already did".
 */
export const FulfillmentHandshakeOutcomeValues = [
  'accepted',
  'rejected',
  'cancellation-accepted',
  'cancellation-rejected',
  'no-op',
] as const;

export type FulfillmentHandshakeOutcome = (typeof FulfillmentHandshakeOutcomeValues)[number];

export interface FulfillmentHandshakeResult {
  readonly outcome: FulfillmentHandshakeOutcome;
  /**
   * The key actually sent, or `null` on a `no-op` (nothing was sent).
   *
   * Reported so a caller — and the retry spec — can assert the key's stability
   * across attempts without reaching into the repository.
   */
  readonly idempotencyKey: string | null;
  /** The attempt the call was made under, `null` on a `no-op`. */
  readonly assignmentAttempt: number | null;
  /** Present only on a rejection: the rejecter's opaque reason. */
  readonly rejectionReason: string | null;
  /** Present only on a rejection: whether the rejecter is excluded from re-sourcing. */
  readonly blocking: boolean | null;
}
