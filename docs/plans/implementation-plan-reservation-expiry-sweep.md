# Implementation Plan: state-dependent reservation expiry sweep (#2346)

**Date**: 2026-08-26
**Status**: Ready for Review
**Estimated Effort**: ~1 day

---

## 1. Task Summary

**Objective**: expire OL's advisory reservation holds without ever republishing stock that is
still promised. REVIEW § 3 C1: a naive sweep releases a fraud-held order's reservation, republishes
the units, and the later dispatch oversells — with every counter internally consistent, so nothing
alerts.

**Classification**: Infrastructure (worker handler + scheduler task) + CORE (the obligation
predicate and the expiry service).

---

## 2. The constraint that shapes everything: `order_holds` does not exist

#2346's obligation predicate is specified as *"an open `order_holds` row"*. **That table is not on
this branch and will not be merged in** (the programme keeps one PR per body). Every reference in
the tree is a placeholder: `derive-order-lifecycle-phase.ts:69` ("pass `null` until then"),
`order-record.repository.ts:1059` ("no persisted source until Wave 2"), `orders.controller.ts:494`.

So the sweep **fails closed**:

- **extend** whenever an obligation cannot be *ruled out*;
- **release** only on a positive "no obligation".

With no hold source every candidate is indeterminate, so the pass extends and releases nothing. It
ships **inert with respect to release** and becomes live when #2339 arrives. That is the safe
direction on a path whose unsafe direction is an oversell.

**AC-2 limitation, stated rather than papered over**: *"an expired reservation with no obligation
is released and republished"* is assertable only through a **test seam that injects the predicate**,
not end-to-end. No `order_holds` row will be faked to make it look end-to-end.

---

## 3. Two deviations from the issue text, both deliberate

### 3.1 It is NOT `runBoundedSweep`, and #2317 already set that precedent

`bounded-sweep.ts` itself distinguishes the **scan-offset** family (a stable set a run reads
through) from **frontier-as-query** (remaining work re-derived from a predicate). The candidate set
here is `status = 'held' AND expiresAt < now`, and **every page CONSUMES its own selection** — a
released row leaves the set, and an extended row leaves it too because `expiresAt` moves forward. An
advancing offset over a shrinking set steps over rows and leaves holds unexamined, silently.

That is exactly the reasoning `inventory-provenance` (#2317) recorded when it reused the sweep
*primitives* (budget clamp, lock TTL, lock-key shape) and not the offset machinery. This pass does
the same. Every AC the shape exists to deliver still holds structurally — budgeted, per-run locked,
never advancing past unfinished work, self-terminating — because a failed page persists nothing.

**No `MasterSweepKind` member is added.** That union is master-prefixed and its keys read
`master.{kind}.sweep:…`; `master.reservation-expiry.sweep` would be a false name. The pass needs no
resume cursor at all (the predicate is the frontier), only a lock.

### 3.2 Unbounded extension is a real hazard, bounded by AGE not by a column

Fail-closed means indeterminate ⇒ extend. With no hold source that is true forever, so without a
second bound the sweep re-extends every hold on every tick indefinitely — a permanent write
treadmill and a `held` set that never drains. Bounded by **age**: past
`OL_RESERVATION_OBLIGATION_MAX_AGE_MS` the sweep still **extends** (never releases — that is the
whole point) but additionally emits the needs-attention fact AC-3 already asks for. Age uses the
existing `createdAt`; **no column, no migration, slot `1854000000000` stays free.** This mirrors the
#2330 returns sweep, which bounds by age precisely because bound-1 is only as good as a declaration
that may be missing.

---

## 4. Design

### 4.1 The predicate (CORE, pure)

`libs/core/src/inventory/domain/types/reservation-obligation.types.ts`

```ts
export const ReservationObligationKindValues = ['open-order-hold'] as const;
export type ReservationObligationKind = (typeof ReservationObligationKindValues)[number];

export type ObligationVerdict = 'present' | 'absent' | 'indeterminate';

/** One reader per kind. A NEW kind with no entry is a COMPILE ERROR. */
export type ObligationReaders = {
  readonly [K in ReservationObligationKind]: (orderRecordId: string) => Promise<ObligationVerdict>;
};

/** `present` wins over `indeterminate` wins over `absent` — fail closed. */
export function foldObligationVerdicts(v: readonly ObligationVerdict[]): ObligationVerdict;
```

The mapped type is what makes Wave 3 adding `accepted-fulfillment-work` a compile error rather than
a silent omission. For #2339 wiring the *existing* kind the guarantee is different and is stated
honestly: the placeholder is a distinctly named `UnavailableOrderHoldReader` whose spec asserts **no
reservation is ever released while it is bound**, so replacing it is a deliberate act and forgetting
to keeps the safe behaviour.

### 4.2 The service (CORE)

`ReservationExpiryService` on `IReservationService` (release/expire land on that interface per the
#2344 note). Per candidate:

| Verdict | Action |
|---|---|
| `present` / `indeterminate` | **extend** `expiresAt` to `now + ttl`; if `createdAt` older than the age bound, also emit needs-attention |
| `absent` | `releaseHeld({ status: 'expired' })` |

`releaseHeld` is the **only** thing that stops a hold counting (`status = 'held'` is the ATP
predicate, #2345), which is why C1's check gates the **release**, not the publish.

**`atpEffect` is never rewritten** — it is immutable and stamped at creation; extension touches
`expiresAt` alone. Rewriting it would move a published quantity with no audit trail.

Extension needs a new repository method (`extendHeldExpiry`) — a guarded conditional UPDATE
`WHERE status = 'held'`, `affected > 0` as the answer, mirroring `releaseHeld`. Never read-then-act.

### 4.3 The handler (worker)

`inventory.reservations.expire`, lane **`bulk`** (background reconciliation must never delay a
`realtime` order or a `fiscal` document). Per-run lock reusing the sweep's TTL resolver; budget
clamped to the sweep family's page ceiling; global scope under the nil-UUID system connection id,
the #2317 precedent (reservations carry no connection axis). Registered in
`assertFullLaneCoverage`'s partition — a missing lane strands the type in `queued`.

---

## 5. Steps

| # | File | Acceptance |
|---|---|---|
| 1 | `domain/types/reservation-obligation.types.ts` | both arms unit-tested; a new kind fails to compile |
| 2 | `domain/ports/reservation-repository.port.ts` + repository | `extendHeldExpiry` guarded UPDATE; `[[], 0]` tuple shape respected (#2343) |
| 3 | `application/services/reservation-expiry.service.ts` (+ interface) | extend/release/needs-attention matrix |
| 4 | placeholder `UnavailableOrderHoldReader` + its spec | asserts nothing is ever released |
| 5 | worker handler + lane registration + scheduler descriptor | budgeted, locked, resumable-by-predicate |
| 6 | `apps/api/test/integration/reservation-expiry.int-spec.ts` | C1 regression via injected predicate; ATP unchanged after extend |
| 7 | quality gate + parity int-spec | still byte-identical green |

---

## 6. Risks

- **The pass writes on every tick while inert.** Bounded by the age escalation (§ 3.2); the
  extension write is one guarded UPDATE per candidate, in the `bulk` lane.
- **A `diagnostic` hold subtracts from nothing**, so on a default install neither extension nor
  release moves a published number. An integration test asserting an ATP change must stamp
  `published` explicitly (#2344).
- **A hold against a stale position** is already out of ATP but still `held`, so it enters the
  candidate set and releasing it moves no published number — asserted, not assumed.

---

## 7. Alignment

- [x] Fail-closed; release only on a positive absence
- [x] No `atpEffect` rewrite
- [x] Repository ports imported relatively
- [x] No migration; slot `1854000000000` unused
- [x] AC-2's limitation stated in plan, docblock and commit message
