/**
 * Fulfillment Dispatch Relay Service Interface (#2401, `W3a-12`)
 *
 * Consumes the `dispatch` member of `FulfillmentRelayIntent` — the intent
 * `IFulfillmentProgressService.record` REPORTS but cannot perform, because
 * performing it means importing `@openlinker/core/orders` from inside
 * `libs/core/src/fulfillment/**`, which two independent guards forbid (ADR-053's
 * report-don't-perform seam). This is the first consumer of that seam.
 *
 * @module libs/core/src/orders/application/interfaces
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.5
 */
import type { FulfillmentRelayIntent } from '@openlinker/core/fulfillment';

/** The `dispatch` arm, narrowed — this service consumes no other intent kind. */
export type FulfillmentDispatchIntent = Extract<FulfillmentRelayIntent, { kind: 'dispatch' }>;

/**
 * What one `relayDispatch` call did. Distinguishable outcomes rather than a
 * boolean, for the same reason `FulfillmentDispatchRelayClaim` has three
 * statuses: a caller and a test must tell "a peer already relayed" from "there is
 * no such work".
 */
export type FulfillmentDispatchRelayOutcome =
  /**
   * The relay ran and the claim is KEPT.
   *
   * **This does not assert that a participant received the fact.** Three
   * non-delivering paths land here — zero targets, every target structurally
   * `unsupported`, and a bare reasonless `unsupported` — because what this status
   * reports is the CLAIM decision, which is the thing callers act on. Read it as
   * "the relay slot stays burnt", never as "the source was told".
   */
  | { readonly status: 'relayed' }
  /** The relay ran, every target failed transiently, and the claim was released. */
  | { readonly status: 'released'; readonly reason: string }
  /** A peer holds the relay slot. No relay was attempted. */
  | { readonly status: 'already-relayed' }
  /** No such work row. No relay was attempted. */
  | { readonly status: 'unknown-work'; readonly workId: string };

export interface IFulfillmentDispatchRelayService {
  relayDispatch(intent: FulfillmentDispatchIntent): Promise<FulfillmentDispatchRelayOutcome>;
}
