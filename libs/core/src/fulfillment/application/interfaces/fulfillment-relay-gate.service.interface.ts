/**
 * Fulfillment Relay Gate Service Interface (#2401, `W3a-12`)
 *
 * The at-most-once gate for the dispatch relay, exposed as an `I*Service` so a
 * SIBLING context can reach it.
 *
 * ## Why this interface exists at all
 *
 * `FulfillmentWorkRepositoryPort` carries `claimDispatchRelay` /
 * `releaseDispatchRelay`, but it is deliberately NOT on the
 * `@openlinker/core/fulfillment` barrel — a `*RepositoryPort` is an intra-context
 * persistence contract that `scripts/check-cross-context-imports.mjs` rejects by
 * deny pattern. A sibling reaches this aggregate through an `I*Service`, and this
 * is that service.
 *
 * The relay itself is fired from `orders`, never from here: doing it here would
 * mean importing `@openlinker/core/orders`, which
 * `scripts/check-no-injection-contracts.mjs` and `barrel-purity.spec.ts`
 * independently forbid under this directory. That prohibition is ADR-053's
 * report-don't-perform design, not an obstacle to route around.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import type { FulfillmentDispatchRelayClaim } from '../../domain/types/fulfillment-progress-event.types';

export interface IFulfillmentRelayGateService {
  /**
   * Take the work's single dispatch-relay slot.
   *
   * Reads the work FIRST so an unknown id claims nothing, then claims with the
   * conditional UPDATE that is the actual serialisation point — the read is not a
   * guard, so the gap between them is harmless. Projects `orderId` and the holder
   * because the `dispatch` intent carries only a `workId`, which makes this read
   * load-bearing rather than defensive.
   */
  claimDispatch(workId: string): Promise<FulfillmentDispatchRelayClaim>;

  /**
   * Give the slot back after a failed relay, so a LATER progress event can
   * re-drive it.
   *
   * Note what this does not do: it does not make a replay of the SAME vendor
   * event re-drive anything. `IFulfillmentProgressService.record` burns
   * `(workId, idempotencyKey)` before reporting the intent and returns no intent
   * for a duplicate, so recovery comes from the next, differently-keyed event.
   * Un-burning that key is disqualified — it is permanent memory, and re-honouring
   * it would let a replayed event re-move counters, trading a missed relay for
   * corrupted quantities.
   */
  releaseDispatch(workId: string): Promise<void>;
}
