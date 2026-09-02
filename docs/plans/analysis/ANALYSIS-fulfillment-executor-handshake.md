# Pre-Implement Analysis: Executor handshake + `assignmentAttempt` + `fulfillment.work.dispatch` (#2399)

**Plan**: `docs/plans/implementation-plan-fulfillment-executor-handshake.md`
**Branch**: `2399-executor-handshake` off `origin/oms-programme-wave-3a` (tip `c7ee984f1`)
**Date**: 2026-08-30
**Verdict**: **NEEDS-REVISION**

Read-only gate. No source or plan file was modified.

---

## 1. Verified plan claims (the nine the brief named)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 1 | `fulfillment` is a registered zero-sibling-edge leaf, type-only, authorized for `fulfillment-authority` + `order-lifecycle`; a **value** import of `INTEGRATIONS_SERVICE_TOKEN` would fail | **TRUE** | `libs/core/src/__tests__/barrel-purity.spec.ts:180-190` registers the leaf with exactly those two specifiers; `:249` asserts `FORBIDDEN VALUE IMPORT` for any non-type-only `@openlinker/core/*`; `:254-257` requires the specifier be in the allow-set. `@openlinker/core/integrations` is in neither list. |
| 2 | `check-no-injection-contracts.mjs` covers `fulfillment` and scans specs | **TRUE, but narrower than the plan implies** | `scripts/check-no-injection-contracts.mjs:115` `WATCHED_CONTEXTS = ['libs/core/src/fulfillment']`; `:240` walks every `.ts` with no `.spec.ts` exclusion. **But** `:139` `forbidden: ['@openlinker/core/orders','@openlinker/core/inventory']` — it does **not** forbid `@openlinker/core/integrations`. Conversely `barrel-purity.spec.ts:203` **excludes** `.spec.ts`. So an integrations value import in a **spec** is caught by neither guard. |
| 3 | `applyGuardedUpdate` exists; none of `claimDispatchAttempt` / `recordAcceptance` / `recordRejection` / `listBlockingRejections` exists | **TRUE for all four names** | `fulfillment-work.repository.ts:545` `private async applyGuardedUpdate(...): Promise<boolean>`. No fulfillment-scoped hit for the four new names (only unrelated `recordRejection` in `webhooks` + `listings`). |
| 4 | `fulfillment_works` has no `acceptedAt` / `externalWorkId` / `rejectionReason` / `blocking`; no `fulfillment_work_rejections` table | **TRUE** | `fulfillment-work.orm-entity.ts` columns end at `dispatchRelayedAt` / `version` (`:74-133`); no rejection entity anywhere. `acceptedAt` / `externalWorkId` exist today only as **contract** fields on `FulfillmentRequestResult` (`fulfillment-execution.types.ts:128,130,221`). |
| 5 | Migration timestamp tail; `1865000000000` free | **TRUE** | newest on `origin/main`: `1849000000003-add-operational-settings.ts`; newest on branch tip: `1864000000000-create-fulfillment-works.ts`. Zero files match `1865*`. |
| 6 | Parity spec is generic over `TABLES`, so adding a name suffices | **FALSE** | See BLOCKING-1. |
| 7 | `apps/worker/src/fulfillment/` exists; lane tripwire numbers | **PARTLY FALSE** | Directory does **not** exist (`apps/worker/src/` = `content, events, health, integrations, maintenance, roles, scheduler, sync, testing`). Tripwire lives at `apps/worker/src/sync/handlers/__tests__/handler-registration.service.spec.ts` — not the path the plan cites. Current assertions: `:52` `realtime` **13**, `:65` `bulk` **25**, `:66` `fiscal` **5**, `:67` `fan-out` **7**, over **50** job types; `:37` constructs the service with **48** dummy handlers. |
| 8 | `JobTypeValues` has no `fulfillment.work.*`; boot coverage requirement | **TRUE** | `sync-job.types.ts` only `marketplace.fulfillment.statusSync:57`. `sync-job-handler.registry.ts:108-121` `assertFullLaneCoverage()` throws naming every `JobTypeValues` member with no registered handler+lane. |
| 9 | Siblings #2394/#2397/#2400/#2404/#2405 already touching `fulfillment.tokens.ts` / `index.ts` | **NO — none have landed** | `git log` on both files shows only `ebb2e0d39` (#2391), `bd56bcb73` (#2392), `38f05e43f` (#2393), `f86c0fde7` (#2398). Tokens file holds exactly one symbol (`FULFILLMENT_WORK_REPOSITORY_TOKEN:28`). |

---

## 2. BLOCKING

### BLOCKING-1 — The migration-parity spec is **not** generic; step 7 is understated

`apps/api/test/integration/fulfillment-work-migration-parity.int-spec.ts:46` does hold
`const TABLES = ['fulfillment_works','fulfillment_work_lines','fulfillment_holds']`, but three
assertions hardcode the same facts and will fail on a fourth table:

- `:154-158` — `expect(rows.map(r => r.table_name)).toEqual(['fulfillment_holds','fulfillment_work_lines','fulfillment_works'])`.
- `:224-227` — `expect(foreignKeys.map(r => r.conname).sort()).toEqual(['FK_fulfillment_holds_work','FK_fulfillment_work_lines_work'])`; the plan's `ON DELETE CASCADE` FK adds a third name.
- `:201-204` — the CHECK-name list is `toEqual`, so any `@Check` on the new entity also fails it.
- `:234-256` — the CASCADE smoke test inserts into the three tables by name and counts survivors; a rejection row is not covered by it unless added.

The two new **columns** on `fulfillment_works` *are* covered automatically (`COLUMNS_SQL` diff), so
that half of the claim holds. Revise step 7 to name the four edits.

### BLOCKING-2 — `applyGuardedUpdate` returns `Promise<boolean>`; `claimDispatchAttempt` needs a RETURNING value

`fulfillment-work.repository.ts:545-557` is `private async applyGuardedUpdate(operation, build): Promise<boolean>`,
collapsing the result to `(result.affected ?? 0) > 0`. Six existing callers depend on that
(`transitionStatus:292`, `transitionRequestStatus:303`, `assignHolder:314`, `clearHolder:323`,
`incrementAssignmentAttempt:332`, `claimDispatchRelay:352`, `cancel:366`). The plan's §4.1 needs the
`RETURNING "assignmentAttempt"` value, and step 5 says the helper is "extended to surface RETURNING" —
that is a signature change to the file's one shared write choke point, whose docblock states its
purpose is that "the `?? 0` and the error conversion cannot be forgotten per transition". The plan
should say explicitly whether it widens the shared helper (and how the six callers keep their
`boolean`) or adds a sibling private helper. Silently widening a discipline-carrying helper is the
kind of change #2392 wrote that docblock to prevent.

---

## 3. IMPORTANT

### IMPORTANT-1 — Reuse collision: `incrementAssignmentAttempt` already exists and was written **for this issue**

`fulfillment-work-repository.port.ts:169` `incrementAssignmentAttempt(workId: string): Promise<boolean>`,
implemented at `fulfillment-work.repository.ts:331-341`, and the repository's writer-discipline table
at `:22` reads:

> `| assignmentAttempt | incrementAssignmentAttempt (#2399) | monotonic; a round-trip would reset the idempotency key's stability |`

i.e. #2392 shipped the writer and named #2399 as its consumer. It has no production caller — only
`apps/api/test/integration/fulfillment-work-transitions.int-spec.ts:295-303`. The plan never mentions
it and introduces `claimDispatchAttempt` instead (correctly, since the existing method carries no
`requestStatus` guard and returns no attempt number). But the plan must say what happens to it:
leaving an unguarded, uncalled increment on the port alongside a guarded one is exactly the
double-writer shape the writer-discipline table exists to prevent. Either fold it in, delete it (and
its int-spec block), or state why both survive.

### IMPORTANT-2 — ADR-054's acceptance claim is `WHERE acceptedAt IS NULL`; the plan guards on `requestStatus`

Two shipped docblocks state the claim shape verbatim:
`fulfillment-request-status.types.ts:31-33` ("ADR-054 makes acceptance a **conditional claim**
(`WHERE acceptedAt IS NULL`), so at most one holder can accept; the claim column and its
at-most-once semantics land with **#2399**") and `fulfillment-work-action.types.ts:70-73`. The plan's
§4.3 accept arm guards on `requestStatus = 'submitted'` and never mentions `acceptedAt IS NULL`, and
§4.1 property 3 argues against any additional uniqueness. The two may be equivalent in effect, but
the plan is silently diverging from a shape a prior slice pinned in prose *and named this issue as
the owner of*. Either add the `IS NULL` conjunct or record the divergence the way §7-A records the
other one.

### IMPORTANT-3 — The lane tripwire needs three edits, not one

`handler-registration.service.spec.ts` will need: `:52` `13 → 14`; `:51` heading text `50 → 51` job
types; `:37` `Array.from({ length: 48 })` → `49` plus the `:33` comment "the constructor takes the
registry followed by 48 handler instances". Step 12 says only "update the count tripwire". The
docblock at `:1-20` is also a running ledger of every lane change and by local convention gets a
`#2399` line.

### IMPORTANT-4 — `apps/worker/src/fulfillment/` is a new top-level worker directory with unstated wiring

It does not exist. The plan places the handler there but does not mention: a Nest module for it,
importing `FulfillmentModule` (which today exports **only** `FULFILLMENT_WORK_REPOSITORY_TOKEN` —
`fulfillment.module.ts` `exports: [FULFILLMENT_WORK_REPOSITORY_TOKEN]`, so the new handshake service
must be added to both `providers` and `exports`), and registering that module under the `jobs` role in
`AppModule.forRoles` (ADR-051 — a role that is off contributes no providers). Add these to step 12.

---

## 4. NOTE

- **NOTE-1 — `deliveryMethod` is already on the work row.** `fulfillment-work.types.ts:114`
  `readonly deliveryMethod: string | null`. Step 3's "resolve `shipTo` / `deliveryMethod` from the
  order — in the handler" is only true of `shipTo`; taking `deliveryMethod` from the order rather
  than from the work risks disagreeing with the grain `FulfillmentWork` groups on
  (`IDX_fulfillment_works_grouping` on `['orderId','locationId','deliveryMethod']`,
  `fulfillment-work.orm-entity.ts:36`).
- **NOTE-2 — `FulfillmentRequest` also requires `orderId` and `lines`.**
  `fulfillment-execution.types.ts:101-108`. The plan's `DispatchFulfillmentWorkInput`
  (`{ workId, shipTo, deliveryMethod, executor }`) implies both are derived from the loaded work —
  correct, but `FulfillmentRequestLine` mapping is unmentioned in §5 and is real work.
- **NOTE-3 — `FulfillmentWorkRepositoryPort` is deliberately NOT barrel-exported** (`index.ts:77-84`
  exports the input shapes only). New input types for the four methods go in that same `export type`
  block; the port stays unexported.
- **NOTE-4 — the new core service trips `check-service-interfaces.mjs`.** `libs/core/src/**/application/services/*.service.ts`
  must declare `implements` an `I*Service` with a sibling `*.service.interface.ts`, or a `*Port`. The
  plan's step 8 satisfies this; noted so it is not dropped. `fulfillment/application/` does not exist
  yet at all — this is the context's first application layer.
- **NOTE-5 — the guard gap in claim 2 is worth exploiting deliberately, not accidentally.** Because
  `barrel-purity.spec.ts:203` skips `.spec.ts` and the injection script's `forbidden` list omits
  `@openlinker/core/integrations`, a unit spec *could* value-import integrations without either guard
  firing. §3's argument-passing design makes that unnecessary; keep it that way.
- **NOTE-6 — §8's reachability statement checks out.** `FulfillmentExecutor` is in
  `CoreCapabilityValues` (`libs/core/src/integrations/domain/types/adapter.types.ts:76`) and no
  adapter manifest advertises it.
- **NOTE-7 — no sibling has touched `fulfillment.tokens.ts` / `index.ts` yet** (claim 9), so the
  merge-conflict risk in §8 is currently theoretical; the files are small and the plan's
  "keep additions minimal" guidance stands.

---

## 5. Reuse audit summary

| Plan artifact | Status | Path |
|---|---|---|
| `claimDispatchAttempt` | **PARTIAL** — overlaps existing `incrementAssignmentAttempt` | `fulfillment-work.repository.ts:331`, port `:169` |
| `recordAcceptance` / `recordRejection` / `listBlockingRejections` | NEW | — |
| `fulfillment_work_rejections` table + ORM entity | NEW | — |
| `acceptedAt` / `externalWorkId` columns | NEW on the ORM entity; the **contract** fields already exist | `fulfillment-execution.types.ts:128,130` |
| `FulfillmentHandshakeService` + interface | NEW (first `application/` layer in the context) | — |
| `FULFILLMENT_HANDSHAKE_SERVICE_TOKEN` | NEW | `fulfillment.tokens.ts` holds one token today |
| `fulfillment.work.dispatch` job type + handler | NEW | `sync-job.types.ts` has no `fulfillment.work.*` |
| `applyGuardedUpdate` reuse | **EXISTS, but returns `boolean`** | `fulfillment-work.repository.ts:545` |
| Migration `1865000000000-*` | NEW, slot free and above both tails | — |

## 6. Backward-compatibility

| Surface | Finding | Severity |
|---|---|---|
| `FulfillmentWorkRepositoryPort` | additive methods only; port is not barrel-exported | none |
| `applyGuardedUpdate` (private) | return-type widening touches 6 callers | Warning (BLOCKING-2) |
| ORM schema | two nullable columns + one additive table ⇒ migration required | Warning (expected) |
| `JobTypeValues` | additive; boot assertion forces the lane registration in the same commit | Warning (expected) |
| Barrel `@openlinker/core/fulfillment` | additive exports only | none |
| `check:invariants` | no new cross-context edge if §3's argument-passing holds | none |

## 7. Open questions

1. Does `incrementAssignmentAttempt` survive #2399, and if so with what caller? (IMPORTANT-1)
2. Widen the shared `applyGuardedUpdate` or add a sibling helper? (BLOCKING-2)
3. Is the accept claim `requestStatus = 'submitted'`, `acceptedAt IS NULL`, or both? (IMPORTANT-2)
4. Which worker module owns the new handler, and under which role? (IMPORTANT-4)
