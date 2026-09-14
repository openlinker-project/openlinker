# PRE-IMPLEMENT — #2420 (`W3b-7`), Surface G: G4 and proving G1–G3

**Plan:** `docs/plans/implementation-plan-bench-surface-g-verification.md`
**Base:** `c4ac4b436`
**Verdict:** **READY** — with six IMPORTANT reuse findings, one of which makes a proposed
assertion redundant.

No Critical items. The plan touches **no contract surface**: no port, no service, no DI token, no
ORM entity, no DTO, no barrel export, no migration. Every artifact is a `*.spec.ts` /
`*.int-spec.ts`. Phase B/C are therefore trivially clean and the whole of the risk is
*duplication* — asserting something already asserted, or rebuilding a harness that exists.

---

## Phase B — reuse audit

| Plan artifact | Status | Evidence |
|---|---|---|
| **1a** `bench-eligibility-single-rule.spec.ts` | **NEW** | Absent. Precedent to copy: `libs/core/src/__tests__/no-direct-buffer-read.spec.ts` (textual walk, authorized-path table, non-vacuity guard). |
| **1b** `bench-list-and-parcel-agree.spec.ts` | **NEW**, PARTIAL overlap | List side already asserts held/cancelled: `bench-work.service.spec.ts:298,319`. Refusal side already asserts them: `bench-parcel.service.spec.ts:158,175`. **Neither asserts the two AGREE over one shared table** — that is the new content, and it is the content that matters. |
| **1c** `version` / `supportedActions` pass-through | **NEW** | `bench-work.service.spec.ts:61-62` sets `version: 5` and `supportedActions: ['expedite']` in the fixture builder and **never asserts either reaches the view**. Nothing anywhere asserts the bench does not recompute them. |
| **1d** a mid-parcel scan does not bump `version` | **NEW** | `bench-parcel.int-spec.ts:375` asserts the *close* bumps it — but on `seedParcel(1)`, where the single gesture both verifies and closes, so it cannot separate "the scan bumped it" from "the close did". The load-bearing half of 1d is genuinely uncovered. |
| **2 · G1** close writes a user actor | **PARTIAL** | `bench-parcel.int-spec.ts:181-189` asserts `packedByUserId` is non-null in the DB after close. It does **not** assert `packedByService IS NULL`. |
| **2 · G1** reopen clears both actors | **NEW** | `bench-parcel.int-spec.ts:299` asserts the *ledger* voiding (`voidedAt`, `voidedByUserId`) only. Nothing asserts `packedByUserId` / `packedByService` are cleared on the work row. |
| **2 · G2** order-grain first-writer-wins | **ALREADY EXISTS** | `order-record-packed.int-spec.ts:106-112` ("A repeat mark is an idempotent replay… the FIRST stamp and actor survive") and `order-record-packed.service.spec.ts:123`. **See IMPORTANT-1.** |
| **2 · G2** split order, per-work grain | **NEW** | Nothing in the tree constructs two `fulfillment_works` rows against one order. `bench-parcel.service.spec.ts:214` ("story D3 — a split order is unambiguous") is about **parcel index/total rendering**, not the packed fact. |
| **2 · G3** second *distinct* gesture on one line | **NEW at unit level** | Covered at HTTP by `bench-parcel.int-spec.ts:264`. The service spec has only the retry half (`fulfillment-verification.service.spec.ts:277`). |
| **3 · D6** no actor on `FulfillmentProgressEvent` | **NEW** | No actor field exists on the type (grep for `actorUserId`/`performedBy`/`verifiedByUserId` returns nothing), and `fulfillment_progress_claims` carries exactly `workId, idempotencyKey, connectionId, eventKind, claimedAt`. Precedent to copy: `verification-indistinguishable.spec.ts`. |

---

## IMPORTANT findings

**IMPORTANT-1 — Phase 2's G2 "first-writer-wins" is already asserted; as written it adds nothing.**
`order-record-packed.int-spec.ts:106-112` already replays `POST /orders/:id/packed` and asserts the
first stamp and actor survive. The genuinely-uncovered claim is first-writer-wins between **two
distinct actors** — the existing test replays the *same* admin token, so it proves the `packedAt IS
NULL` guard held, not that a second *packer* loses. Reframe Phase 2's G2 to: (a) two distinct user
ids through `IOrderRecordService.markPacked`, and (b) the split-order per-work grain. Otherwise it
is a restatement.

**IMPORTANT-2 — `seedParcel` is not reusable.** It is a `describe`-scoped closure at
`bench-parcel.int-spec.ts:76`, not exported:

```ts
async function seedParcel(totalQuantity = 2): Promise<FulfillmentWork>
```

It also hardcodes `orderId: 'ol_order_bench_parcel'` and **mints a fresh OMS connection on every
call**, so calling it twice yields two works on one order under *two different executors* — not the
shape Phase 2 needs (two works, one order, one connection). Phase 2 must seed its own. Either
export a shared helper or accept the duplication deliberately; the plan should say which.

**IMPORTANT-3 — `seedParcel` creates no `order_records` row, and Phase 2's G2 needs one.**
`orderId` is a plain string with no FK, so no order exists to call `markPacked` against. The
pattern to copy is `order-record-packed.int-spec.ts:74-82`:

```ts
await orderRecordService.persistOrder(makeOrder(), source.id, 'evt-1');
```

This is the step most likely to be missed, and it fails as a confusing 404 rather than as a
missing-seed error.

**IMPORTANT-4 — Phase 1b will duplicate two existing private harnesses.** Both
`bench-work.service.spec.ts` (~148 lines before the first `describe`) and
`bench-parcel.service.spec.ts` (~156 lines) carry their own builders, and `BenchParcelService`
injects **six** dependencies (`BenchExecutorResolver` — a concrete class, not a token — plus
worklist, verification, orders, products, shipments). A third file rebuilding both is a third copy
to keep aligned. Prefer hosting the cross-caller fixture table in one existing file, or extract the
builders once.

**IMPORTANT-5 — `loginAsAdmin` / `loginAsPacker` plain-INSERT a fixed user; at most one call per
test.** Phase 2's two-distinct-actors case must therefore drive `IOrderRecordService.markPacked`
directly with two user ids rather than logging in twice.

**IMPORTANT-6 — process: implementation began during this gate.**
`libs/core/src/fulfillment/__tests__/progress-event-carries-no-actor.spec.ts` was created at
**15:35**, two minutes after the plan (15:33) and while this read-only gate was running. A gate
whose findings land after the code exists is a review, not a gate. Flagged, not acted on.

---

## Phase C — backward compatibility

| Surface | Finding |
|---|---|
| Top-level barrels | Untouched. No export added, removed or renamed. |
| Port signatures | Untouched. |
| DTO shapes | Untouched. `ParcelBody` in the int-spec already exposes `version` and `packedByUserId`, so Phase 1d/G1 need no DTO change. |
| Symbol tokens | Untouched. |
| ORM schema / migrations | **None required.** Finding F1's conditional CHECK is explicitly deferred as "reported, not repaired" — correct: it would be a migration, and a conditional actor constraint on `parcelClosedAt IS NOT NULL` needs its own decision about pre-existing rows. |
| `check:invariants` | Clear. `barrel-purity.spec.ts:232` excludes `*.spec.ts` from its walk, so Phase 3's spec under the `fulfillment` leaf may import freely — no allow-list entry is spent. Phase 1a's walking spec sits in `apps/api` and imports only `node:fs`/`node:path` plus same-app relatives. |

---

## Open questions

1. **Does Phase 2 belong in a new file at all?** Given IMPORTANT-2/3, a new
   `bench-surface-g.int-spec.ts` must re-seed everything. Adding the G1 reopen-clears-actor and the
   `packedByService IS NULL` assertions to `bench-parcel.int-spec.ts` (which already has the
   harness) and keeping the new file for the split-order case only would halve the duplication.
2. **Phase 0/F1 — is "reported, not repaired" the right call for a closed parcel with neither
   actor?** The plan's reasoning is sound (route-gated, and the fix is a migration). Worth an
   explicit line in the issue so it is not rediscovered as a defect later.
3. **Phase 0/F2 — should the missing bench → `order_records.packedAt` edge block #2420's
   acceptance?** AC-3 reads "G2 asserted on a split order — exactly one order-grain fact, first
   writer wins". If nothing writes an order-grain fact from a parcel close, that AC cannot be
   satisfied end to end; it can only be satisfied at the `markPacked` seam. The plan says so
   honestly, but the AC and the plan disagree and someone should reconcile them.
