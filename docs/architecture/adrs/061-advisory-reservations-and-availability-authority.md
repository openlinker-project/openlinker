# ADR-061: OL-owned advisory reservations and the `AvailabilityAuthority` capability

- **Status**: Proposed.
  Split from [ADR-058](./058-multi-location-positions-reservations-availability-authority.md) (R1).
- **Date**: 2026-08-21
- **Authors**: @piotrswierzy

## Context

Nothing sits between a master's own decrement and OL's next poll, so a fast-moving item oversells
between syncs. Vendor reservation semantics are mutually incompatible (soft-reallocatable /
time-boxed / hard-committed). ANALYSIS-1032 §6I designed and stress-tested a reservation
mechanism whose *wave* was cut for lacking a close event on `omp_fulfilled`. The five-panel
review (R1) added hard constraints: no `inventory ↔ fulfillment` edge on the ATP path; guards
must persist evidence before the boundary they protect; retries must resume, not reject.

## Decision

**(1)** OL's neutral reservation is a **ledger-recorded, time-boxed, advisory claim on ATP**
(never a decrement; `expiresAt` mandatory), using §6I's mechanism — with three R1 amendments:
the publish-subtraction scope is a **stamped column** (`atpEffect: 'published' | 'diagnostic'`,
written at creation by the ingestion caller that holds the routing outcome — `published` only for
OL-executed orders, so no cross-context read exists and Wave 5's double-subtraction cannot
recur); reserve is **get-or-create** (`ON CONFLICT DO NOTHING` + re-select = success; a differing
quantity is an explicit delta-adjust); expiry is **state-dependent** (the sweep extends — never
releases — a reservation whose order has an open hold or accepted work; expiry against accepted
work surfaces in needs-attention). Consume is a **claim** (`Shipment.reservationConsumedAt`,
conditional, sweep-driven), so a short-circuiting dispatch retry cannot lose it. Adapters declare
fidelity via `ReservationBinding = advisory | time-boxed | hard-committed`; inability to hold is
declared by *not implementing* `AvailabilityHolder`. `InventoryMasterPort.reserveInventory/
releaseInventory` are deprecated in place (ANALYSIS-1032 §5 forbids outright removal).
**(2)** A dispatched `AvailabilityAuthority` capability answers ATP per scope. **Scope claims
live in `Connection.config`** (pure coercer — never a port call, so selection stays pure and
lazy-compatible); the port carries `getFreshness()` (cacheable) and `getAvailability()` (chunked
by OL to the adapter's declared `maxBatchSize`). Resolution falls back to the computed path
(`Σ(available − olReserved[published]) − buffer`) **only for unclaimed scopes**; an ambiguous
claim or erroring authority yields provenance `'unknown'` — **suppress the publish write and
alert** (OL persists no last-published number), bounded by `OL_AVAILABILITY_UNKNOWN_MAX_HOLD_MS`,
then a conservative floor under a distinct provenance value. An exact-scope claimant beats an
enclosing `global` one (overlap ≠ ambiguity). **(3)** The buffer is reclassified as a Control,
applied only when the authority did not apply its own. `InventoryMaster` (stock-fact mirror) and
`AvailabilityAuthority` (promise computation) stay separate capabilities.

## Alternatives considered

- **Shopify's seven-bucket schema**: requires OL to be the on-hand system of record; OL's
  positions are mirrors. The distinction (hold ≠ decrement) is adopted without the buckets.
- **Delegating reservations to the master**: no shipped master has a hold primitive; puts an
  un-idempotent HTTP call on the order-accept path.
- **`getAuthorityScopes()` on the port**: rejected (R1) — forces eager adapter construction and
  makes the "pure" selection fallible on the publish hot path.

## Consequences

**Pros:** the oversell window closes at ingestion on OL-executed paths; shortfalls are named
facts; a DOMS or 3PL answers ATP per scope with declared fidelity and bounded blast radius.
**Cons:** `olReservedQuantity` is denormalised (reconciler required); the `'unknown'` floor is a
deliberate underselling trade-off, stated rather than hidden.

*Reversal gate (prose-only):* an oversell traced to a topology where reservations are diagnostic-only
re-opens the scoped-subtraction rule; a master adapter that can implement a hold primitive
un-defers `MasterReservationWriter`.

## References

- Related ADRs: [ADR-058](./058-multi-location-positions-reservations-availability-authority.md), [ADR-028](./028-order-cancellation-stock-restore.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md), [ADR-062](./062-trust-posture-authority-holding-capabilities.md)
- Design doc: [DESIGN-oms-authority-model](../../plans/analysis/DESIGN-oms-authority-model.md) §4
- Review record: [REVIEW-oms-authority-model](../../plans/analysis/REVIEW-oms-authority-model.md)
