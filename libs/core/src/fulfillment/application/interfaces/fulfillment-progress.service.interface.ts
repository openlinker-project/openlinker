/**
 * Fulfillment Progress Service Interface (#2400, ADR-053/054)
 *
 * The SINGLE core-side seam through which fulfilment progress enters
 * OpenLinker. One method, on purpose: an executor webhook (#2399), a polling
 * `FulfillmentStatusSource` (#2398) and an operator action (#2406/#2410) all
 * report the same facts, and three entry points would be three places for the
 * dedup to be forgotten.
 *
 * ## It REPORTS a relay, it never fires one
 *
 * `record()` returns `FulfillmentRelayIntent[]`; the caller composes. Firing
 * means touching `@openlinker/core/orders`, forbidden under this directory
 * independently by `scripts/check-no-injection-contracts.mjs` and by
 * `barrel-purity.spec.ts`'s `ZERO_SIBLING_EDGE_LEAVES` allow-set, which for
 * this leaf is exactly `['@openlinker/core/fulfillment-authority',
 * '@openlinker/core/order-lifecycle']` and rejects every other
 * `@openlinker/core/*` specifier *including type-only*.
 *
 * That prohibition is ADR-053's report-don't-perform discipline — the #2100
 * `SalesDocumentBlockOutcome` seam — not an obstacle to work around. The
 * evidence the placement is right is that this change adds **zero** entries to
 * either guard's allow-set. Needing one would be the signal the placement is
 * wrong.
 *
 * ## Nothing calls this in production yet, and that is deliberate
 *
 * `fulfillment.work.statusSync` READS its reference, logs, and completes — it
 * resolves nothing (resolution to an OL `workId` is #2399's) and it does
 * NOT construct an event, because there is no authoritative source to construct
 * one from. The only thing an inbound webhook can offer is
 * `CanonicalInboundEvent.payload`, which core documents as *"Non-authoritative
 * payload hint; never source of truth"* — moving counters off it would be
 * exactly the failure the webhook-as-trigger discipline (#904) prevents.
 *
 * #2398's `FulfillmentStatusSource.getFulfillmentStatus(workRef)` is the
 * authoritative read, and becomes this method's first production caller. Until
 * then it is exercised by specs. Shipping a seam ahead of its consumer is this
 * programme's established posture, not a shortfall: `FulfillmentRouterPort`
 * (#2393) has no implementer either, and all four vocabulary leaves shipped
 * ahead of their consumers so the adopting contexts adopt one spelling.
 *
 * @module libs/core/src/fulfillment/application/interfaces
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import type {
  FulfillmentProgressEvent,
  FulfillmentProgressOutcome,
} from '../../domain/types/fulfillment-progress-event.types';

export interface IFulfillmentProgressService {
  /**
   * Record one reported progress fact, at most once.
   *
   * Never throws for a business condition — every non-applied case is a named
   * `FulfillmentProgressOutcome` status. Infrastructure faults still propagate.
   */
  record(event: FulfillmentProgressEvent): Promise<FulfillmentProgressOutcome>;
}
