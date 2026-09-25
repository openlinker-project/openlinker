# ADR-075: Per-destination relay claims

- **Status**: Proposed
- **Date**: 2026-09-25
- **Authors**: @norbert-kulus-blockydevs

## Context

OpenLinker relays a lifecycle event to every participant of an order. Three
services do it, at three grains, and all three record the attempt with the same
idiom: a nullable timestamp claimed by a conditional `UPDATE ... WHERE <column>
IS NULL`, released on transient failure so a later tick retries.

- `Shipment.waybillRelayedAt` (#1947) — the late-waybill relay.
- `Shipment.reservationConsumedAt` (#2347) — the ledger close at dispatch.
- `FulfillmentWork.dispatchRelayedAt` (#2401) — the work-grain dispatch relay.

The idiom is sound and has closed real defects. What it cannot express is a
MIXED result, because the claim is one column on one row while a relay fans out
to N participants. Both relay services hit that wall independently and both
resolved it the same way — release only when EVERY target failed transiently —
and both wrote down why, naming #861:

> A mixed result keeps the claim: one target applied, and releasing would
> re-relay that succeeded participant on the next event.
> — `fulfillment-dispatch-relay.service.ts`

> we keep today's all-or-nothing retry, and bound the blast radius at the
> adapter instead. Genuinely per-participant retry is #861.
> — `shipment-status-sync.service.ts`

So a participant that fails while a sibling succeeds is never retried. On the
waybill path the consequence is that the marketplace never learns the order
shipped, which #2073 made operator-visible as a failure counter — explicitly a
DISPLAY field with no gate reading it, precisely so it did not become a second,
accidental answer to this question.

#861 as filed also named two workarounds. One is gone: the push-first ordering
it described was replaced by `waybillRelayedAt`, whose own docblock calls the
marker "the first row of that model". The other, the `>= dispatched` gate, is
still there and is now deliberate rather than provisional — `ShipmentDispatch
NotificationService` owns that transition and the poll must not race it.

## Decision

Build per-destination relay claims, as a **narrow generalisation of the claim
idiom that already exists** rather than as the single reconciler #861 also
floated. The claim moves from one column on the relaying row to one row per
`(relaying row, participant connection, event kind)`, carrying the same three
states the column carries today — unclaimed, claimed, released-with-a-reason —
plus the failure attribution #2073 already records for display.

The relay services keep calling the capability. What changes is that each
target's outcome is recorded against that target, so a retry re-drives only the
participants that did not apply, and the all-or-nothing rule in both services
is deleted rather than re-justified.

**Not decided here, and deliberately:** whether the claims live in a dedicated
table or inside `OrderRecord.syncStatus`, and whether `waybillRelayFailure*`
becomes the roll-up above them or is deleted. Both depend on whether a second
`OrderSource`-capable destination per order is real load or a hypothetical, and
neither is answerable from the code alone.

## Alternatives considered

- **Single reconciler owning every capability-B call** (#861's own second
  option). Rejected for now: it makes `ShipmentDispatchNotificationService` and
  `ShipmentStatusSyncService` inputs rather than actors, which is a rewrite of
  two shipped services to fix a retry asymmetry, and it would have to absorb
  the `>= dispatched` ordering gate as scheduling logic rather than letting it
  stay the explicit statement it now is.
- **Leave it, keep bounding the blast radius at the adapter.** This is today's
  answer and it is defensible per adapter — the Allegro waybill POST treats a
  409 as already-attached, so a repeat is a no-op. Rejected as the standing
  answer because it needs every adapter to be independently idempotent for
  every event, which nothing checks and no contract requires.
- **Widen `waybillRelayFailure*` into the retry state.** Rejected because that
  field was built as display-only under the #2100 discipline, and the reason is
  still good: a counter an operator reads and a gate a relay branches on have
  different correctness requirements, and conflating them is how a badge
  quietly starts deciding whether a marketplace gets told.

## Consequences

**Pros:**

- A permanently-broken destination stops re-driving healthy ones, which is the
  concrete defect all three services documented and none could fix locally.
- The `>= dispatched` gate becomes the only remaining coordination rule between
  the two relay services, instead of one of two.
- #2073's counters keep their display-only posture rather than being pressed
  into a job they were explicitly built not to do.

**Cons / trade-offs:**

- Three shipped claim columns stay where they are. This generalises the idiom
  for the FAN-OUT case; it does not retire `reservationConsumedAt`, which
  claims a non-relay act and has no participants.
- Per-participant retry means a relay can now be partially applied for longer,
  because the succeeded half is no longer re-driven. That is the point, and it
  makes the failure less visible in the log — the operator-facing counter
  matters more after this than before it.
- The storage shape is left open, so the implementing issue carries a decision
  this ADR did not make.

**Migration path:**

- The existing columns are the first rows of the new model, not something to
  backfill from. A claimed `waybillRelayedAt` with no per-participant rows means
  "claimed before this shipped", and the relay must read it as already-relayed
  for every participant rather than as an empty set.

## References

- Related issues: #861 (this decision), #2073, #1947, #2347, #2401
- Related ADRs: [ADR-011](./011-domain-entity-behavior.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md) § Orders
