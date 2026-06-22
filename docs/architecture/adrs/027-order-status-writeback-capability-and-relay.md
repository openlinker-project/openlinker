# ADR-027: Order status writeback capability & lifecycle relay

- **Status**: Accepted
- **Date**: 2026-06-22
- **Authors**: @piotrswierzy

## Context

OpenLinker ingests an order from a source and creates it in a destination, but does not keep the two systems' lifecycles in sync afterwards (see #1157). Closing that gap means OL must **write a lifecycle fact (dispatched + tracking, cancelled) back to a participating system**. Today two unrelated capabilities each do a slice of this:

- `OrderDispatchNotifier.notifyDispatched({tracking, carrier})` — event-specific, resolved on the **source** (marketplace) connection.
- `OrderFulfillmentUpdater.updateFulfillment({status, tracking})` — generic status setter, resolved on the **destination** (shop) connection.

The order routing is `OrderSource → OrderProcessorManager`, where either side may be a shop or a marketplace (incl. **shop → OL → shop**). A relay that writes to "the other participant" therefore needs a capability that is **role- and platform-agnostic** — not one shape for shops and another for marketplaces, which would push platform-shaped branching into the orchestrator.

The **inbound** side already models this correctly: a single `OrderSource` feed with an `OrderFeedEventType` discriminator (`created | updated | cancelled | paid`) — event-as-data. The outbound side should mirror it.

## Decision

1. **A single, platform-neutral, role-agnostic writeback capability — event-as-data.** `OrderStatusWriteback.write(event): Promise<OrderWritebackResult>`, where `event` is a discriminated union (`dispatched{trackingNumber?, carrier?} | cancelled{reason?} | …`). **Every** participant adapter (shop and marketplace) implements it, mapping each event onto its own API; unsupported transitions are reported via `OrderWritebackResult` (e.g. `applied | unsupported | rejected`), **not** via the type signature. New events are added as union members — never new methods or capabilities. This collapses `OrderDispatchNotifier` and the writeback role of `OrderFulfillmentUpdater` into one contract.

2. **A core lifecycle-relay application service** owns all cross-system propagation, resolving each participant's adapter and dispatching via the `isOrderStatusWriteback` guard — by capability, never by platform type — so all topologies (incl. shop→shop) are served by construction. It is a **best-effort relay**: OL owns no canonical status; it forwards facts authored by authoritative systems.

3. **Mandatory guardrails** for bidirectional propagation: idempotency per `(order, event, source-event-id)`, self-echo suppression, monotonicity + authority precedence, and explicit failure surfacing (never silently drop — the #1132 behaviour). These reuse the existing `webhook_deliveries` dedup + shipment at-most-once gate.

## Alternatives considered

- **Method/capability per event** (`OrderCancelNotifier`, `OrderDeliveredNotifier`, …). Rejected: elevates a closed data enum to the type level; capability proliferation; asymmetric with the inbound event-as-data feed.
- **Keep two shapes, branch in the relay** (shop → `updateFulfillment`, marketplace → `notifyDispatched`). Rejected: platform-shaped polymorphism in the orchestrator — the smell capabilities exist to remove; breaks shop→shop.
- **One generic `updateFulfillment(status)` for all** (marketplace ignores statuses it can't map). Rejected: silent no-ops / LSP violation — caller can't tell which statuses are honoured. The discriminated event + result type makes support explicit.
- **Build it as part of #1032.** Rejected: #1032 (OL-owned canonical status) is deferred; this is a relay that owns no canonical status. Conflating them mislabels a deferred bet as in-build.

## Consequences

**Pros:**
- One contract; the relay has zero platform branching; topology-agnostic incl. shop→shop.
- Symmetric with the inbound feed; adding events is additive.
- The guardrails are exactly the primitives a future #1032 would reuse — foundation, not throwaway.

**Cons / trade-offs:**
- Touches shipped capabilities (`OrderDispatchNotifier`, `OrderFulfillmentUpdater`).
- Cross-system writes carry echo/loop risk — hence the non-optional guardrails.

**Migration path:**
- Introduce `OrderStatusWriteback`; have Allegro and PrestaShop implement it; route the relay through it. Retain `OrderFulfillmentUpdater` for order **provisioning** (OL driving an order it created), out of the relay path. Fold `OrderDispatchNotifier` into the new capability.

## References

- Related issues: #1157, #1032, #1132
- Related ADRs: [ADR-012](./012-branch-1-fulfillment-modeling.md), [ADR-015](./015-inbound-event-routing-capability-translated.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Listings / OfferManagerPort sub-capabilities (capability + guard pattern)
