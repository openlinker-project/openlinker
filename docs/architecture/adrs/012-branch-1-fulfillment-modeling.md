# ADR-012: Branch-1 (OMP-fulfilled) fulfillment modeling — delegate-to-OMP, not a degenerate shipping adapter

- **Status**: Accepted
- **Date**: 2026-05-25
- **Authors**: @piotrswierzy

## Context

The #832 fulfillment-routing model (#732) routes each `(orderSource, sourceDeliveryMethod)` to one of three **processor kinds**: *OMP-fulfilled* (the destination shop ships via its own carrier setup), *OL-managed carrier* (OL drives an own-contract carrier — InPost ShipX, #812), *source-brokered* (OL drives the marketplace's own shipping — Allegro Delivery, #833). Branches 2 and 3 map cleanly onto `ShippingProviderManagerPort` (#763) — one capability, different adapters. **Branch 1 is the genuine fork:** the OMP (PrestaShop) ships externally, OL generates no label and holds no provider shipment id. How should branch 1 be modeled?

## Decision

Branch 1 is **not** a `ShippingProviderManagerPort` adapter. It stays on the existing `OrderProcessorManagerPort` + `CarrierMapping` path it uses today — OL sets the destination carrier on the mirrored OMP order; the shop's own workflow ships. Only branches 2/3 implement `ShippingProviderManagerPort`. Branch-1 status read-back becomes a separate, small `FulfillmentStatusReader` capability — **named here, implemented in #834**.

The routing rule carries an explicit, **stored** `processorKind` discriminator (an operator choice — *not* derived from declared capabilities, since one connection may declare several). A single core dispatch orchestrator owns the `switch (processorKind)`; downstream consumers call the orchestrator rather than re-branching. The orchestrator lands with the first executor (#835/#833), not in #832.

**Rule shape & compatibility.** The rule stores only `{ processorKind, processorConnectionId }`. The OMP destination is *derived* (= the processor connection for `omp_fulfilled`; the order's fan-out destination set otherwise) and the branch-1 destination carrier is sourced from the **co-keyed `CarrierMapping`** (same `(source, method)` key) — neither is a stored column. Routing is **operator-configured per `(source, method)`** and validated at save against each processor's **declared capability + topology** (`omp_fulfilled` → declares `OrderProcessorManager`; `ol_managed_carrier` / `source_brokered` → declares `ShippingProviderManager`, with `source_brokered` requiring `processorConnectionId === sourceConnectionId`). **Method-granular auto-detection** — whether an order's `delivery.method.id` is Allegro-Delivery-eligible (the order-method ↔ `/shipment-management/delivery-services` namespace question, OQ-B1) — is a **#833 refinement layered behind the routing-compatibility seam, not a dependency**: the model functions on operator config + capability validation regardless of how OQ-B1 resolves, and a method-incompatible choice surfaces as a readable error at label generation. Compatibility lives behind the service seam so the routing model never reshapes if the compatibility signal's source changes.

## Alternatives considered

- **(i) Degenerate PrestaShop `ShippingProviderManagerPort` adapter** (`generateLabel` = assign-carrier/no-op, `getTracking` = read PS), unifying all targets to "ship-capable connections." **Rejected.** It can't honor the contract: `GenerateLabelResult.providerShipmentId`/`labelPdfRef` are non-nullable and provider-issued (branch 1 has neither), and `getTracking({providerShipmentId})` is keyed on an id branch 1 never gets. Making it fit means widening both — degrading the contract for the adapters that *do* generate labels (#812, #833) — and writing fabricated ids into the partial-unique `providerShipmentId` index. The "uniformity" is illusory: dispatch and status consumers must still branch on "is this the fake adapter?", so (i) hides the fork instead of removing it.
- **(iii) Overload the `Shipment` lifecycle** for branch 1 (`generated` = "carrier assigned"). **Rejected.** Overloads `ShipmentStatus` and conflates shipment status with order/workflow status — against #827's separable-axes requirement.

## Consequences

**Pros:**
- Keeps `ShippingProviderManagerPort` honest for the only adapters that generate labels; models branch 1 as what it is.
- Scales by *adding adapters*: same-mechanic processors are new adapters (zero switch growth); a new arm appears only for a genuinely new mechanic (e.g. a future 3PL/fulfilment-house).
- Branch-1-as-delegate survives even if OL later becomes the system-of-record — dropship/3PL fulfillment OL observes-but-doesn't-perform is permanent.

**Cons / trade-offs:**
- A `switch (processorKind)` exists (dispatch + status acquisition) — contained in one orchestrator.
- `processorKind` is stored config that can drift from a connection's real capabilities; compatibility validation guards rule creation.

**Migration path:**
- Additive — new `fulfillment_routing_rules` table; `connection_carrier_mappings` preserved as the branch-1 carrier detail and the resolution fallback.

## References

- Related issues: #832, #732, #834 (`FulfillmentStatusReader`), #835 (InPost convergence), #833 (Allegro Delivery), #763
- Related ADRs: [ADR-011](./011-domain-entity-behavior.md)
- Primary doc: [docs/architecture-overview.md](../../architecture-overview.md) § Capability Abstractions (Business Roles); spec `docs/specs/product-spec-732-allegro-delivery-shipment.md` § "Is this three capabilities, or one?"
