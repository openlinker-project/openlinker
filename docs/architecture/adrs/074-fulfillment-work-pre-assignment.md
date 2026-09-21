# ADR-074: Pre-assigning a `FulfillmentWork` to a packer

- **Status**: Proposed
- **Date**: 2026-09-21
- **Authors**: @norbert-kulus-blockydevs

## Context

`FulfillmentWork` (ADR-054) carries `packedByUserId: string | null`, stamped *after* the fact by
whichever packer finishes the work. Any packer may claim any unassigned work object,
first-click-wins, through the bench's claim flow. There is no field naming who a parcel is *for*
before it is touched, so a supervisor has no way to route a specific parcel to a specific packer
ahead of time (#3329's "Assign Packing Work" proposal).

Three pieces of shipped machinery bound this decision. `assignedConnectionId` on `FulfillmentWork`
(ADR-054) names the *holder connection* — the 3PL/OMS executor — not a person; a pre-assignment
field is a different axis and must not reuse or shadow it. The executor handshake and
`assignmentAttempt` counter (#2399) govern how a work object is offered to and accepted by its
holder connection; a per-packer pre-assignment happens *inside* an already-accepted `openlinker`
connection's own holder and does not touch that contract. The timeout-reap sweep (#2712) reroutes
an unaccepted *dispatch* back to re-sourcing — a different failure mode (a holder connection never
answers) from an idle *person* a supervisor named.

## Decision

Add two nullable columns to `fulfillment_works`: `assignedToUserId: string | null` and
`selfServeEligible: boolean` (default `true`). Assignment is **advisory, not exclusive** by
default — an assigned parcel stays claimable by any packer (rendered visible-but-muted, the
Jira-swimlane treatment over Cin7's hide-entirely one), matching #3329's mockup. Setting
`selfServeEligible: false` is the explicit escape hatch for a supervisor who wants a hard
assignment; it is a per-parcel operator decision, not a policy default.

No automatic expiry ships in v1. An idle assigned-and-locked parcel stays visible to the assigning
supervisor for manual reassignment; an automatic reap (mirroring #2712) is deferred until real
usage shows staleness is a problem, rather than guessing a timeout now.

This is explicitly **outside** the ADR-052 fulfilment-authority matrix. That matrix answers which
*system* decides fulfillment-execution (A3) — already answered as OpenLinker when
`openlinker.oms.v1` holds the work. Which *person* inside that system handles it is a staffing
decision one layer below the matrix, and the matrix must not grow a row for it.

## Alternatives considered

- **A separate assignment/join table.** Rejected: no work object needs more than one concurrent
  pre-assignment, so a column matches `packedByUserId`'s own precedent; a join table buys nothing
  here.
- **Assignment as an exclusive lock by default.** Rejected as the default: if the named packer is
  out sick, nobody could touch the parcel without an explicit unassign step first. `selfServeEligible:
  false` gives an operator that stricter behaviour when they deliberately want it, rather than
  forcing it on every assignment.
- **An automatic reap timer, modeled on #2712, from day one.** Deferred rather than rejected — no
  data yet on what a sane timeout would be; shipping a guessed number is worse than shipping none.

## Consequences

**Pros:**
- Additive, nullable columns — no behavioural change for any existing unassigned work object.
- Reuses the repository's existing narrow-conditional-UPDATE discipline (`FulfillmentWorkRepositoryPort`)
  rather than introducing a new writer shape.

**Cons / trade-offs:**
- `selfServeEligible: false` with no expiry means a mis-assigned, forgotten parcel can sit locked
  until a supervisor notices — accepted for v1, named as the reason a v2 reap pass may be needed.

**Migration path:**
- One migration adding `assignedToUserId` (nullable `text`) and `selfServeEligible` (`boolean not
  null default true`) to `fulfillment_works`.
- `FulfillmentWorkRepositoryPort` gains `assignToPacker(workId, userId)`, `clearAssignment(workId)`,
  `setSelfServeEligible(workId, boolean)` — each a single conditional `UPDATE`, no full-row save.
- One admin/operator-gated HTTP write endpoint for the assignment action.
- The bench's list/claim read projects the two new fields so a row can render "assigned to you" /
  "unassigned" / "assignment only."

## References

- Related issues: #3329, #3331
- Related ADRs: [ADR-054](./054-fulfillment-work-unit-of-assignment.md), [ADR-053](./053-fulfillment-authority-vocabulary-leaf.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
