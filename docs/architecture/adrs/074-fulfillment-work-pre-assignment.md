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

`assignedToUserId` and `selfServeEligible` are coupled by one invariant: `NOT selfServeEligible`
implies `assignedToUserId IS NOT NULL`. An unassigned-and-locked parcel — nobody may work it —
is not a state this decision allows, so it must not be reachable through
`setSelfServeEligible(workId, false)` on unassigned work, nor left behind by
`clearAssignment(workId)` on an exclusively-assigned one. The write API keeps the two axes as
**separate calls** — `assignToPacker(workId, userId)` and `setSelfServeEligible(workId, boolean)`
— because they are independent decisions in time: a supervisor routinely assigns a parcel first
and decides on exclusivity later (or never), and a combined signature would force every
assignment to also state an exclusivity opinion. The invariant is instead enforced at **every**
writer that could otherwise reach it: `setSelfServeEligible(workId, false)` refuses when no
packer is assigned; `clearAssignment` resets `selfServeEligible` to `true` in the same statement
that nulls `assignedToUserId`, so a cleared parcel never hands its predecessor's exclusivity
decision to whoever is assigned next; and a class-level `@Check`
(`fulfillment-work-migration-parity.int-spec.ts`'s territory, per #2392's own precedent for this
table) is the DB-level backstop for anything that reaches the row outside these two guarded
paths — a defense-in-depth line, not the primary one, since the application-level guards are
what make the state unwritable through the port in the first place.

The affordance is not the boundary. `selfServeEligible: false` changes what the bench *renders*;
what actually refuses a non-assignee from doing the work is a check inside the write path a
packer reaches by acting on a parcel — today that is `verifyUnit` (`POST
.../:workId/verifications`) and, for the same reason, `reopenParcel` (`POST
.../:workId/reopen`). Neither the bench's nav nor its list/claim projection is a trust boundary;
per #3322's framing landing the same week, a hidden or muted affordance grants nothing, and the
API remains the authorization boundary. The implementation epic must add this check to both
endpoints before `selfServeEligible: false` means anything beyond a rendering hint.

An exclusive assignment to a user who is later deactivated or deleted degrades to the same
locked-forever case as an unnoticed mis-assignment (see Cons) — there is no FK from
`assignedToUserId` to the users table (consistent with this table's reference-by-value
discipline: `orderId`, `productVariantId` and `assignedConnectionId` all carry none), so nothing
detects or reacts to the assignee going away. Accepted for v1, on the same "no data yet on a sane
timeout" reasoning as the deferred reap below.

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
- One migration adding `assignedToUserId` (nullable `uuid` — matching the sibling
  `packedByUserId` column on this table rather than restating a user-id reference with a second
  spelling) and `selfServeEligible` (`boolean not null default true`) to `fulfillment_works`,
  plus a class-level `@Check` (`CHK_fulfillment_works_exclusive_needs_packer`) under the
  migration's own constraint name enforcing `NOT (selfServeEligible = false AND assignedToUserId
  IS NULL)` — declared by name so the migration and the `synchronize`-built test schema agree,
  the same discipline `fulfillment-work-migration-parity.int-spec.ts` already checks for this
  table.
- `FulfillmentWorkRepositoryPort` gains `assignToPacker(workId, userId)`, `clearAssignment(workId)`
  and `setSelfServeEligible(workId, boolean)` — each a single conditional `UPDATE`, no full-row
  save. `assignToPacker` is not claim-once like `assignHolder`: a supervisor may reassign an idle
  parcel, so its guard is existence-only. `setSelfServeEligible(workId, false)` is guarded on
  `assignedToUserId IS NOT NULL` (`true` is unguarded — it is both the column default and the
  state `clearAssignment` restores, so refusing it would refuse a no-op). `clearAssignment` resets
  `selfServeEligible` to `true` in the same statement that nulls `assignedToUserId`.
- The two new rows for `fulfillment-work.repository.ts`'s per-column writer table:
  `assignedToUserId` — writers `assignToPacker`, `clearAssignment` (always `null`);
  `selfServeEligible` — writers `setSelfServeEligible`, `clearAssignment` (always `true`). Unlike
  #2728's declined `shippedAt` column — rejected there as *"a sixth writer on a five-writer
  table, a second source of truth, and backfillable only from the same `eventKind` read"* —
  neither new column duplicates a fact the table or the claim rows already hold, so the "second
  source of truth" objection does not apply here; the writer-count discipline does.
- `verifyUnit` and `reopenParcel` gain the actual enforcement: both refuse a non-assignee when
  `selfServeEligible` is `false` on the addressed work object, with a distinguishable error
  naming the assignee. This is the authorization boundary; the bench read below is a rendering
  affordance only.
- One admin/operator-gated HTTP write endpoint for the assignment action.
- The bench's list/claim read projects the two new fields so a row can render "assigned to you" /
  "unassigned" / "assignment only."

## References

- Related issues: #3329, #3331
- Related ADRs: [ADR-054](./054-fulfillment-work-unit-of-assignment.md), [ADR-053](./053-fulfillment-authority-vocabulary-leaf.md), [ADR-052](./052-independently-assignable-fulfillment-authorities.md)
- Primary doc section: [docs/architecture-overview.md](../../architecture-overview.md)
