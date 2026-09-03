# Implementation Plan: Relay hygiene — `authoredByConnectionId`, `(workId, key)` dedup, `dispatchRelayedAt` claim (#2401)

**Date**: 2026-08-31
**Status**: Ready for Review
**Issue**: #2401 (`W3a-12`, Wave 3a stream S1, epic #2412). **Answers #861.**
**Depends on**: #2400 (`W3a-11`, merged)
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective.** Make the fulfilment dispatch relay safe to drive from replayable vendor
progress events: exclude the event's **author** from the relay targets, gate the relay
behind the already-built `dispatchRelayedAt` at-most-once claim, and release that claim
when the relay fails so a retry re-drives it.

**Context.** #2400 shipped `IFulfillmentProgressService.record()`, which claims
`(workId, idempotencyKey)` and then **reports** a `FulfillmentRelayIntent` rather than
firing one — it cannot fire, because firing means importing `@openlinker/core/orders`,
which `scripts/check-no-injection-contracts.mjs` and `barrel-purity.spec.ts` independently
forbid under `libs/core/src/fulfillment/**`. That is ADR-053's report-don't-perform seam.
**This issue is the first consumer of that intent**, and it must live where acting is legal.

Two hazards close here, both named by DESIGN §5.5 and REVIEW C9:

1. Without excluding the author, a `dispatched` relay tells the 3PL that just shipped the
   parcel that the parcel shipped.
2. Without a relay-grain claim, a replayed progress event re-drives a **non-idempotent**
   source waybill POST — the failure #861 was opened about, one grain up from #1947's
   `Shipment.waybillRelayedAt`.

**Classification**: CORE / Application (+ one CORE Infrastructure repository method).

---

## 2. Scope & Non-Goals

### In scope
- `OrderLifecycleRelayInput.authoredByConnectionId?: string` and the widened exclusion set.
- `FulfillmentWorkRepositoryPort.releaseDispatchRelay(workId)` + its repository implementation.
- A fulfilment-side claim/release seam (`IFulfillmentRelayGateService`) that a sibling
  context may legally reach — because `FulfillmentWorkRepositoryPort` is deliberately **not**
  on the `@openlinker/core/fulfillment` barrel.
- An `orders`-side consumer (`FulfillmentDispatchRelayService`) that turns a
  `FulfillmentRelayIntent` of kind `dispatch` into exactly one relay, claim-then-release-on-failure.
- Unit specs + one int-spec proving at-most-once under genuine concurrency.
- Doc updates: `architecture-overview.md` (§ Orders relay, § cross-context dependency map).

### Out of scope (with owners)
- **The `reroute` intent.** It needs #2395's router and the routing lock, and a read of
  `order.cancelledAt`. Owned by #2395/#2397; this plan consumes only `dispatch`.
- **The shipment bridge** (a `shipped` event minting/observing a shipment) — **#2402**.
- **Generalised per-participant notify state beyond dispatch** — #861's wider question.
  See § 9 for exactly how much of #861 this closes.
- **Wiring a production caller of `record()`.** Still none (#2398's poller is the first).
  The consumer is exercised by specs; that is the wave's shape, not an omission.
- `ShipmentDispatchNotificationService` / `ShipmentStatusSyncService` are **not touched**.
  #1947's `unsupportedReason` split and its at-most-once gate keep their exact semantics.

---

## 3. Architecture Mapping

| Concern | Lives in | Why not elsewhere |
|---|---|---|
| Author exclusion | `libs/core/src/orders/application/{interfaces,services}/order-lifecycle-relay*` | The relay is an `orders` service; the exclusion set is its own rule. |
| `releaseDispatchRelay` | `libs/core/src/fulfillment/domain/ports/` + `infrastructure/persistence/repositories/` | The column is on `fulfillment_works`; the writer must be its own repository. |
| Claim/release seam | `libs/core/src/fulfillment/application/` (`IFulfillmentRelayGateService`) | A sibling context may import an `I*Service` from a barrel, never a `*RepositoryPort` (`check-cross-context-imports` deny pattern). |
| Intent consumer | `libs/core/src/orders/application/services/fulfillment-dispatch-relay.service.ts` | It injects `IOrderLifecycleRelayService`; doing that from `fulfillment` is forbidden twice over. |

**New core edge**: `orders → fulfillment` (value: token + service interface; type: `FulfillmentRelayIntent`).
Cycle-safe because `fulfillment` is a registered zero-sibling-edge leaf — it imports no
sibling context at all, so no CJS cycle can form. `OrdersModule` gains `FulfillmentModule`
in `imports`. The dependency map in `architecture-overview.md` is updated.

---

## 4. Design decisions (the load-bearing ones)

### 4.1 The exclusion set is a union, and absent means unchanged

```ts
const excluded = new Set<string>([input.originConnectionId]);
if (input.authoredByConnectionId) excluded.add(input.authoredByConnectionId);
const targets = externalIds.filter((e) => !excluded.has(e.connectionId));
```

A `Set` rather than a two-term predicate so `author === origin` collapses instead of
double-filtering. **Absent ⇒ byte-identical to today's single-term filter**, which is AC2
and is pinned by a spec that asserts the target list, not merely the call count.

`originConnectionId` keeps its shipped meaning and stays **required** — widening it to
optional would let a caller relay to every participant including the author by omission,
the wrong failure direction for a field whose whole job is suppression.

**Why the field is not redundant with `originConnectionId`.** They coincide for this
issue's consumer (a work-dispatch fact is authored by the holder, and the holder is the
only origin there is). They do **not** coincide for the shipped
`ShipmentDispatchNotificationService`, which passes the **carrier** connection as origin
precisely because an OL-managed shipment's true origin is the operator — origin there is a
routing convenience, not an authorship claim. The new field names authorship explicitly so
a caller with both facts can state both. **This is the plan's one genuine judgement call
and is flagged to the requester before implementation** (§ 10).

> **Superseded during implementation (#2401).** The paragraph above is kept as the
> record of what was planned, but the shipped consumer does NOT pass the holder as
> `originConnectionId`. Following the shipped `AUTOMATION_RELAY_ORIGIN` precedent it
> passes a non-participant sentinel `'openlinker:fulfillment'` as origin — excluding
> nothing — and the holder as `authoredByConnectionId`. The two are therefore
> genuinely distinct in this consumer, which makes the new field load-bearing in
> production rather than only in specs, and dissolves the judgement call §10 flagged.
> The code and `architecture-overview.md` are the record for this point, not §4.1.

### 4.2 Router-filtered destinations get no relay — deliberate, and said so

DESIGN §5.5: a router-filtered destination gets no `syncStatus[]` entry, so it is not an
order participant and the relay never resolves an `externalOrderId` for it. That is by
design, not an oversight, and the relay service header will say so — otherwise the next
reader files it as a bug.

### 4.3 Two claims, two different lifetimes — and this is the answer to "how wide"

| Claim | Predicate | Kind | Released? |
|---|---|---|---|
| `(workId, idempotencyKey)` (#2400) | composite PK, unconditional `ON CONFLICT DO NOTHING` | **permanent memory** | never |
| `dispatchRelayedAt` (#2392, consumed here) | `WHERE "dispatchRelayedAt" IS NULL` | **held slot, then permanent memory** | on relay failure only |

The first is permanent memory because "this vendor already told us this fact" is true
forever; it is deliberately **not** partially-unique on a live-state subset (the
`reservations`/`order_changes` shape), because there is no terminal state after which a
replayed key should be honoured again. Burning it is the point.

The second is a **held slot while the relay is in flight** — it excludes a concurrent peer
observing the same transition — and becomes permanent memory the moment the relay
succeeds. Release-on-failure is what converts it back to a free slot, and is why the
predicate is exactly `IS NULL` and not, say, `IS NULL OR older than N minutes`: a
time-based reopen would re-drive a **non-idempotent** source waybill POST on a slow relay,
which is the defect, not the fix.

### 4.4 `releaseDispatchRelay` is conditional, unlike its shipping precedent

`ShipmentRepository.releaseWaybillRelay` is an unconditional `UPDATE … SET
waybillRelayedAt = null`, documented as safe because only the claim holder calls it.
The fulfilment twin **adds `AND "dispatchRelayedAt" IS NOT NULL`** for a reason the
shipping table does not have: `fulfillment_works.version` counts *state changes, not
writes*, and every header transition bumps it inside `applyGuardedUpdate`. An
unconditional release would bump `version` on a row it did not change, handing #2406's
optimistic-concurrency consumer a spurious stale-token 409. Conditional keeps
"re-releasing is harmless" true **and** keeps the version counter honest.

Signature stays `Promise<void>`: the boolean would only ever distinguish "already
released", which no caller may branch on — but the implementation logs a debug line on a
zero-row release, since a claim holder releasing nothing is worth seeing.

**Single-writer discipline verified, not assumed** (tech-review): `FulfillmentWorkRepository`
has **no `toOrm` and no raw upsert** at all, and `create` sets `dispatchRelayedAt = null`
insert-only — so no unrelated work write can round-trip the column and defeat the claim.
The repository's per-column writer table gains `releaseDispatchRelay` beside
`claimDispatchRelay` in the same change; that table exists precisely so an unnamed writer
is a visible defect.

### 4.5 The claim seam returns a discriminated result, never a bare boolean

```ts
export type FulfillmentDispatchRelayClaim =
  | { readonly status: 'claimed'; readonly orderId: string; readonly holderConnectionId: string | null }
  | { readonly status: 'already-relayed' }
  | { readonly status: 'unknown-work'; readonly workId: string };
```

A boolean conflates "a peer won the race" with "there is no such work", and the caller
must treat them differently (the first is success, the second is a defect worth logging).
This mirrors `FulfillmentProgressOutcome`'s own four-status honesty.

`holderConnectionId` is `string | null` because `FulfillmentWork.assignedConnectionId` is
nullable (unassigned, or cleared after a rejection). **A `null` holder must not silently
become "no author"** — the consumer relays with no `authoredByConnectionId` and logs, which
is the correct degradation: an unassigned work has no author to exclude.

`holderConnectionId` is a **snapshot, not a lock**: `assignedConnectionId` moves on a
re-route, so the value projected at claim time is the holder as of the claim, which is the
correct thing to exclude from a relay about work that holder dispatched. The gate's read is
consequently **load-bearing rather than defensive** — the `dispatch` intent carries only a
`workId`, so `orderId` and the holder exist nowhere else.

**Read-then-claim ordering** matches #2400's service exactly: read first so an unknown work
id never burns anything, then claim. The read is not a guard (the claim is), so the
TOCTOU between them is harmless — the conditional UPDATE is the serialisation point.

### 4.7 What "a retry re-drives it" does and does not mean

Releasing `dispatchRelayedAt` frees the relay slot — it is what stops a failed relay
burning the work's only chance forever. It does **not** make a replay of the *same* vendor
event re-drive the relay: `record()` burns `(workId, idempotencyKey)` **before** reporting
the intent, and #2400 returns **no** intent for a `duplicate`, deliberately, because
re-emitting one would re-fire a relay. So recovery comes from the **next**, differently-keyed
progress event.

Un-burning the progress claim to close that gap is **disqualified**, not merely declined.
That key is **permanent memory**, not a held slot — #2400 argued the distinction explicitly
against the partial-unique precedents — and un-burning it lets a replayed vendor event
**re-move counters**. That trades a missed relay for corrupted quantities: wrong on every
axis.

The genuine closure is a reconcile sweep over `dispatchRelayedAt IS NULL AND` shipped work.
That is **filed as its own issue**, not folded in here: a sweep carries its own cadence,
budget and lane decision (ADR-050), and designing one inside a hygiene slice is how a PR
stops being reviewable. It also sits adjacent to #2402/#2398, both live.

### 4.6 No migration

`dispatchRelayedAt` and `version` already exist (#2392, migration `1864000000000`).
`fulfillment_progress_claims` already exists (#2400, `1865000000000`). This issue adds no
column, no index and no table — so **no new migration, and no `TABLES` line in
`fulfillment-work-migration-parity.int-spec.ts`**. The wave-tail check is still re-run
immediately before pushing, to confirm nothing here needs one.

**The #2400 composite-PK / `RETURNING` trap does not apply here**, and that is checked
rather than assumed: `claimDispatchRelay` goes through `applyGuardedUpdate` and tests
`result.affected` on an UPDATE against a single-column PK, so there is no `RETURNING` to
be silently empty. (#2400's `claim()` needed an explicit `.returning('"workId"')` because
an `orIgnore()` INSERT emits none without it, and returned `false` forever until it had
one.)

---

## 5. Implementation Plan

### Phase 1 — `orders`: author-aware exclusion

1. **`order-lifecycle-relay.service.interface.ts`** — add optional
   `authoredByConnectionId` to `OrderLifecycleRelayInput` with a docblock stating: absent ⇒
   today's exclusion set; present ⇒ unioned with origin; why it is not redundant (§4.1).
   *Acceptance*: `pnpm type-check` clean; no existing caller changes.
2. **`order-lifecycle-relay.service.ts`** — union exclusion via `Set`; extend the file
   header with the router-filtered-destination note (§4.2).
   *Acceptance*: the `no target participants` debug branch still fires when every
   participant is excluded.
3. **Spec** `order-lifecycle-relay.service.spec.ts` — three cases: author X ⇒ X absent from
   targets; `authoredByConnectionId` absent ⇒ target list identical to origin-only; author
   === origin ⇒ one exclusion, not two.
   **Case 1 is only evidence if `originConnectionId !== X` AND X has an external-id
   mapping** — otherwise it passes with the new field ignored entirely.

### Phase 2 — `fulfillment`: release + the claim seam

4. **`fulfillment-work-repository.port.ts`** — declare `releaseDispatchRelay(workId: string): Promise<void>`
   with the §4.4 rationale.
5. **`fulfillment-work.repository.ts`** — implement via `applyGuardedUpdate`
   (`SET dispatchRelayedAt = null, version = version + 1 WHERE id = :id AND "dispatchRelayedAt" IS NOT NULL`).
6. **`application/interfaces/fulfillment-relay-gate.service.interface.ts`** —
   `IFulfillmentRelayGateService { claimDispatch(workId): Promise<FulfillmentDispatchRelayClaim>; releaseDispatch(workId): Promise<void> }`.
   The result type goes in `domain/types/fulfillment-progress-event.types.ts` beside
   `FulfillmentRelayIntent` (same subject, same file, moves together).
7. **`application/services/fulfillment-relay-gate.service.ts`** — read → claim → project.
   Imports nothing outside its own context (the barrel-purity invariant).
8. **Token + module + barrel** — `FULFILLMENT_RELAY_GATE_SERVICE_TOKEN` in
   `fulfillment.tokens.ts` (Symbol only, rule 6); provider + `exports` in
   `fulfillment.module.ts`; `export type { IFulfillmentRelayGateService }` in `index.ts`.
   **`FulfillmentDispatchRelayClaim` must reach the barrel too** — the `orders` consumer
   names it; it rides on the existing `export * from './domain/types/fulfillment-progress-event.types'`
   line, which is verified rather than assumed.
   **Conflict watch**: all three files are named in the brief as likely sibling collisions —
   after any merge, grep `fulfillment.module.ts` for a duplicated `exports:` key.
9. **Spec** — claim wins once; second call reports `already-relayed`; unknown work reports
   `unknown-work` and burns nothing; release is a no-op on an unclaimed row.

### Phase 3 — `orders`: the intent consumer

10. **`fulfillment-dispatch-relay.service.interface.ts`** + **`fulfillment-dispatch-relay.service.ts`** —
    `relayDispatch(intent)`:
    claim → (not `claimed` ⇒ return, no relay) → `relay({internalOrderId: orderId,
    originConnectionId: holder, authoredByConnectionId: holder, event: {type:'dispatched'}})`
    → **on failure, release**.
    **The release predicate, corrected by tech-review.** `writeToTarget` CATCHES every
    adapter throw and returns `{outcome: 'rejected'}`; `relay()` throws only from
    `getExternalIds`. So the realistic failure — a source waybill POST that 500s — is
    `rejected` with **no** `unsupportedReason`. Release therefore fires when a target
    reports `rejected` **or** `unsupported` with the TRANSIENT `adapter-unresolved`
    (#1947). A structural `no-capability` does **not** release: there is nothing to retry,
    so releasing would re-drive the relay forever against a participant that can never
    accept it. **Zero targets does not release either** — with author-exclusion added, a
    single-participant order whose only participant IS the holder is now a routine path,
    and `[].every(...)` is vacuously true, so an unguarded predicate would release and
    re-claim on every replay forever.
11. **Token + module wiring**; `OrdersModule` imports `FulfillmentModule`.
12. **Spec** — relay fired once; **a `{targets:[{outcome:'rejected'}]}` result releases
    the claim** (the case production actually produces — a mock that THROWS is a check
    that cannot fail here, since `relay()` does not throw); a thrown error also releases;
    a `no-capability` result does **not** release; **zero targets does not release**;
    `already-relayed` fires no relay at all.

### Phase 4 — integration + docs

13. **Int-spec** `apps/api/test/integration/fulfillment-dispatch-relay.int-spec.ts` —
    seed a work row, fire **N overlapping `relayDispatch` calls with `Promise.all`**
    against real Postgres, assert the relay adapter was invoked **exactly once** and
    `dispatchRelayedAt` is non-null. **Red-first evidence is mandatory**: run it once with
    the `andWhere('"dispatchRelayedAt" IS NULL')` removed from `claimDispatchRelay` and
    confirm it fails with >1 invocation. A sequential version of this test passes against
    no guard at all and is therefore not evidence (#2392/#2399 both hit this).
14. **Docs** — `architecture-overview.md`: the `OrderStatusWriteback` relay section gains
    the author-exclusion paragraph and the router-filtered note; the cross-context map
    gains `orders --> fulfillment`. Add a `docs/lessons.md` entry only if implementation
    surfaces a genuinely new trap.

---

## 6. Alternatives Considered

1. **Fire the relay from `fulfillment`.** Rejected — forbidden by two independent guards,
   and the prohibition is the design (ADR-053), not an obstacle to route around.
2. **Export `FulfillmentWorkRepositoryPort` from the barrel** so `orders` claims directly.
   Rejected — `check-cross-context-imports` rejects `*RepositoryPort` by deny pattern; the
   `I*Service` seam is the sanctioned route and the barrel says so in a comment.
3. **Put the consumer in `shipping`** beside `ShipmentDispatchNotificationService`.
   Rejected — `shipping` is #2402's territory this wave, and a work-grain dispatch relay is
   not a shipment fact. Revisit only if #2402 shows the two must share a lock.
4. **Reuse `(workId, idempotencyKey)` as the relay gate.** Rejected — that key is
   per-vendor-event; two *different* events (`shipped` then a corrected `shipped`) carry
   different keys and would each relay. The relay's grain is the WORK, which is exactly why
   ADR-054 put a column on the work row.
5. **A time-boxed reopen of the claim.** Rejected — see §4.3.

---

## 7. Risks & Edge Cases

| Risk | Handling |
|---|---|
| Crash between claim and relay | Claim stays set; the relay never fires. **Accepted and stated**: this is the #1947 posture — at-most-once, not exactly-once, because the alternative re-drives a non-idempotent POST. A reconcile sweep is a follow-up, not this issue. |
| `assignedConnectionId` is `null` | Relay proceeds with no author exclusion, logged. §4.5. |
| Sibling merge collides in `fulfillment.module.ts` | Grep for two `exports:` keys after any merge — valid TS that silently drops the first (brief; `docs/lessons.md` § merge-drops-a-brace). |
| `record()` has no production caller | The partial-write hazard #2400 documented stays unreachable; unchanged by this issue. |
| Relay partially applied (one target ok, one transient) | Claim is **kept** — releasing would re-relay the succeeded target. Logged as a warning. Per-participant notify state is the #861 remainder (§9). |

---

## 8. Testing Strategy

- **Unit**: relay exclusion (3 cases), gate service (4 cases), consumer (4 cases).
- **Integration**: one concurrency spec (§5.13), red-first verified.
- **Mocking**: ports only. The int-spec uses a real repository against Testcontainers
  Postgres and a stubbed writeback adapter.

### Acceptance criteria (from #2401)
- [ ] An event authored by connection X produces no relay to X.
- [ ] Absent `authoredByConnectionId` reproduces today's exclusion set exactly.
- [ ] Concurrent progress events relay at most once per work (int-spec, red-first).
- [ ] A failed relay releases the claim, freeing the relay slot. **Narrowed (see §4.7):**
      re-drive comes from the NEXT progress event, not from replaying an identical vendor key.
- [ ] Tests added for non-trivial logic.
- [ ] No CORE ↔ Integration boundary violations (`check:invariants` green).

---

## 9. How much of #861 this answers

**Answered.** #861 asked for durable state recording "OL projected fulfilment status X to
destination Y at time T" as the seam that (a) supplies idempotency for outbound fulfilment
pushes and (b) lets multiple projectors compose without per-pair coordination hacks. For
the **dispatch** fact at **work** grain, this issue supplies exactly that: a durable,
conditionally-claimed marker with an explicit release, consumed through one service that
owns the relay decision — so a second projector coordinates by losing the claim rather than
by inventing a gate.

**Not answered — and #861 must NOT be closed.** #861's state is per-**destination**; `dispatchRelayedAt` is per-**work**.
A relay that succeeds for one participant and transiently fails for another cannot record
that asymmetry, so retry stays all-or-nothing and a permanently-broken destination still
re-drives the source — the precise limitation #1947 recorded and the reason #861 was
filed. #861 should therefore be **narrowed, not closed**, to "per-participant notify
state", with this issue linked as the work-grain half. Recommendation recorded here rather
than acted on: the issue lifecycle forbids closing by hand.

---

## 10. Questions & Assumptions

**Flagged to the requester before implementation** (§4.1): `authoredByConnectionId` and
`originConnectionId` carry the same value for this issue's only consumer. The field is
still added — the issue and DESIGN §5.5 both require it, and it is genuinely distinct for
the shipped carrier-as-origin caller — but a reviewer should know the new parameter is
exercised by specs and by future callers rather than by a divergence in this diff.

**Assumptions**: (1) `dispatched` is the right `OrderLifecycleEvent` member for a work
dispatch — to be confirmed against `order-lifecycle-event.types.ts` at implementation, and
the tracking fields left absent since a work-dispatch fact carries no waybill (#2402 owns
the shipment that would). (2) No production caller is wired this issue.

---

## Related Documentation
- [ADR-027](../architecture/adrs/027-order-status-writeback-capability-and-relay.md), [ADR-053](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md), [ADR-054](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md)
- [DESIGN §5.4/§5.5](./analysis/DESIGN-oms-authority-model.md), [REVIEW C9](./analysis/REVIEW-oms-authority-model.md)
