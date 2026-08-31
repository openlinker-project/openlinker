# Pre-Implementation Readiness Gate: Shipment Bridge (#2402 / `W3a-13`)

**Date**: 2026-08-31
**Plan**: `docs/plans/implementation-plan-shipment-bridge.md`
**Branch**: `2402-shipment-bridge` (base `origin/oms-programme-wave-3a`)
**Scope**: read-only. No source and no plan file was edited by this gate.

---

## Verdict: `NEEDS-REVISION`

No contract break and no reuse collision — but **three plan statements are refuted or
materially sharpened by the live tree**, and two of them would have produced a silent defect
if implemented as written. Details in §3.

---

## 1. Reuse audit

| Plan artifact | Status | Evidence |
|---|---|---|
| `shipments.fulfillmentWorkId` column | **NEW — confirmed absent** | `shipment.orm-entity.ts:74-160` and `shipment.entity.ts:33-148` enumerate every column; no `fulfillmentWorkId` / `workId`. No in-flight sibling adds one. |
| `shipment_lines` table | **CONFIRMED ABSENT** | Only reference tree-wide is the deferral comment at `1864000000000-create-fulfillment-works.ts:57`. |
| Existing work-linkage columns | EXIST, elsewhere | `fulfillment_work_lines.fulfillmentWorkId` (`1864…:98`), `fulfillment_holds.fulfillmentWorkId` (`1864…:119`), `fulfillment_progress_claims.workId` (`1865…:54`). None is on `shipments`. |
| Migration slot | **`1868000000000` free** | Highest core prefix `1867000000000-add-fulfillment-handshake.ts`; highest plugin prefix `1767900000000` (allegro, the only dir in `scripts/plugin-migration-dirs.json`). |

## 2. Backward-compatibility

| Surface | Finding | Severity |
|---|---|---|
| `CreateShipmentInput` + optional field | **Safe.** Construction sites are plain annotated object literals — `fulfillment-status-sync.service.ts:416`, `shipment-dispatch.service.ts:434`, plus repo specs. No `satisfies`, no exact-object idiom. | OK |
| `ShipmentDispatchInput` + optional field | **Safe.** Sites: `shipment.controller.ts:255` (annotated literal), 3 int-specs, `makeInput(overrides: Partial<…>)`. Derived `BulkShipmentDispatchItem = Omit<ShipmentDispatchInput,'sourceConnectionId'>` picks the field up automatically; `bulk-shipment-dispatch.service.ts:71` spreads `...item`, so it survives the bulk path. | OK |
| ORM schema | Migration required. Slot `1868000000000`. | Warning (expected) |
| Name collision | Allegro's `AllegroCreateShipmentInput` / `buildCreateShipmentInput` is an unrelated type. No impact. | OK |

**No Critical items.** Nothing is removed, renamed, retyped, or made required.

## 3. Findings that revise the plan

### F-1 — `buildOrmEntity` is a silent-failure trap. **Must be in the plan's steps.**

`ShipmentRepository.create()` calls `repository.save(entity)` on a **fully-populated** entity
built by `buildOrmEntity` (`shipment.repository.ts:197-243`), which assigns every column
explicitly (including `= null` for unset ones).

Adding the column to the ORM entity **but forgetting `buildOrmEntity`** does not fail to
compile — `save` simply omits the column and the DB writes `NULL`. The linkage would be
silently absent on every row while every type-check and lint passes. The plan's step list must
name `buildOrmEntity` explicitly, and test **T4** must assert the persisted value (not the
call argument), or it cannot catch this.

Three mapping sites must change together:
1. `buildOrmEntity` (`:197`) — write on create.
2. `toDomain` (`:288-313`) — **23 positional constructor args**; the new field must be appended
   at the **END**, which `shipment.entity.ts:47-53` explicitly mandates.
3. `Shipment` domain entity constructor — same append-at-end rule.

### F-2 — the update path is already safe; writer discipline is confirmed, not merely intended.

`buildUpdatePayload` (`:264-286`) builds a `Partial<ShipmentOrmEntity>` behind
`if (patch.x !== undefined)` guards, so a column absent from `UpdateShipmentInput` can never be
rewritten. `claimWaybillRelay` / `claimReservationConsume` / `releaseWaybillRelay`
(`:141,:158,:187`) are targeted single-column updates. **Keeping `fulfillmentWorkId` out of
`UpdateShipmentInput` is therefore sufficient** to guarantee write-once — no extra guard needed.
Plan §4.2 stands as written and is now evidence-backed.

### F-3 — the parity-spec plan is backwards. **Revise §5.**

The plan proposes attempting `TABLES + 'shipments'` first. Evidence says start the other way:
**13 separate migrations** touch `shipments` —
`1799000000000-add-shipments-table`, `…000006-add-shipment-source-delivery-method`,
`…000007-add-branch-one-shipments-uq-index`, `1801000000000-AddShipmentDeliveryIntent`,
`1802000000000-add-shipment-carrier`, `1809000000000-add-order-fulfillment-state`,
`1832000000000-add-shipment-provider-code`, `1832000000007-add-shipment-waybill-relayed-at`,
`1849000000008-create-returns`, `1849000000009-create-order-changes`,
`1854000000000-add-shipment-reservation-consumed-at`, `1862000000000-add-shipment-direction`,
`1866000000000-create-routing-decisions`.

`1862000000000-add-shipment-direction` in particular adds a column default and drops it in the
same statement — precisely the shape that diverges between a migration-built and a
`synchronize`-built schema. The parity spec's own docblock (`:26`) says it is *"scoped
deliberately to the `fulfillment_*` tables: a whole-schema diff would fail on pre-existing
drift this issue neither caused nor can fix."*

**Revised approach**: write the **targeted** assertion (the new column's `data_type` /
`is_nullable`, and the new index's `indexdef`, compared across both databases) as the
deliverable. Probing the whole-table diff is optional and time-boxed; if it goes red on
unrelated drift, record the drift as a finding and do not weaken or silence the spec.

---

## 4. Open questions carried to `/tech-review`

1. **D-2 (auto-dispatch deferral) — sharpened, and the sharpening strengthens it.** The plan
   claims no order→recipient/parcel projection exists. Refined: a **`recipient` projection does
   exist, in the browser** — `apps/web/src/features/orders/lib/dispatch-input.ts:116-141`, pure
   and framework-free, deriving recipient from the order snapshot. But **`parcel` is an
   operator-supplied argument** (`args.parcel` — dimensions, weight, template), derived from
   nothing in the order, and the same module ships a `missing-recipient` ineligibility reason
   proving the recipient half legitimately fails for some orders. So an automatic dispatch would
   have to **invent parcel weight and dimensions**, which determine what the carrier charges and
   whether the label is valid at all. The deferral holds, on firmer ground than the plan states.
2. Boundary with #2401 on who consumes the `shipment` relay intent — coordinator to confirm.

### F-4 — the new relay-intent member is invisible to the compiler. **A guard that cannot fail.**

`FulfillmentRelayIntent` (`fulfillment-progress-event.types.ts:147`) has exactly **three
references tree-wide**, all inside `fulfillment-progress.service.ts` (`:49` import, `:148`
array construction, `:174` embedded in the `recorded` arm) plus one doc-comment. **Nothing
anywhere narrows on `FulfillmentRelayIntent.kind`.**

The `never` exhaustiveness guard at `fulfillment-progress.service.ts:199-206` protects the
**event** union (`FulfillmentProgressEvent.kind`), not the intent union. And
`noFallthroughCasesInSwitch` (`tsconfig.base.json:20`) only catches a missing `break`, never a
non-exhaustive union.

So adding `{kind:'shipment'}` **compiles silently, and nothing — no build, no lint, no existing
test — would notice if it were never emitted or never consumed.** That is precisely this
programme's "check that cannot fail" defect class.

**Required revision to the plan's test strategy**: the plan's T-table has no test that the
intent is actually *emitted*. Add:

- **T8** — `record()` on a `shipped` event returns an intent list containing exactly one
  `{kind:'shipment'}` with the right `workId`; made to fail first by not emitting it.
- **T9** — the `duplicate` path returns **no** intent (the replay guarantee #2400 documents),
  made to fail first by emitting unconditionally.

Adding a `never`-guarded switch over the intent union at the (future) consumer is the
structural fix, but that consumer is #2401's; within this issue the two tests are the guard.

### F-5 — `findByOrderId` already exists. Scope shrinks.

`FulfillmentWorkRepositoryPort.findByOrderId(orderId): Promise<FulfillmentWork[]>`
(`fulfillment-work-repository.port.ts:188`) is already there. So the planned
`IFulfillmentWorkQueryService` **adds no repository method** — it only surfaces an existing one
across the context boundary, which is exactly what the import rules force (the port matches
`check-cross-context-imports.mjs`'s `/RepositoryPort$/` deny pattern at `:589` and is
deliberately absent from the barrel, `fulfillment/index.ts:81`).

There is **no** by-order-**and**-connection variant; the service filters the returned array
caller-side. State that in the plan rather than adding a port method.

### F-6 — token name-collision hazard in `shipping.tokens.ts`.

`shipping.tokens.ts` **already declares `FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN`** — a
shipping-owned `FULFILLMENT_*` token for the older, shipping-local notion of "fulfillment"
(unrelated to the `fulfillment` context). Both `shipping/index.ts:15` and
`fulfillment/index.ts:133` do `export *` over their token files, so a same-named token in both
would be ambiguous for any consumer star-importing both barrels.

**Any new token introduced by this issue must be checked against both files by name.** Prefer
a name that cannot be confused with the shipping-local family.

### F-7 — the context edge is clean, and needs no allow-list entry. **Plan §3 confirmed.**

- `shipping` imports **nothing** from `@openlinker/core/fulfillment` today (zero hits).
- `fulfillment` imports **nothing** from `@openlinker/core/shipping`, and cannot —
  `barrel-purity.spec.ts:180-191` lists it in `ZERO_SIBLING_EDGE_LEAVES` with only
  `fulfillment-authority` + `order-lifecycle` authorized, and
  `check-no-injection-contracts.mjs:115,138` watches the directory independently.
- `check-cross-context-imports.mjs` is **name-shape based per symbol**, with no per-context
  edge matrix — so the edge itself is not a concept it gates. `^I[A-Z]\w*Service$` (`:596`) and
  the UPPER_SNAKE token pattern both pass; only a `*RepositoryPort` import would be denied.
- **`ALLOW_LIST` (`:101`) contains no entry for shipping or fulfillment, and none is needed.**
  The plan's stated success criterion — zero new allow-list entries — is achievable and is met.
- Module graph: `FulfillmentModule` imports no sibling at all, so `ShippingModule →
  FulfillmentModule` is **acyclic**.

### F-8 — no module currently has duplicate keys.

`FulfillmentModule` and `ShippingModule` were both inspected: no duplicate provider/export
keys today. The wave's known two-`exports:`-keys hazard is a *merge* risk, not a present
defect — re-check after any rebase, as the plan says.

One pre-existing asymmetry noted in passing (not this issue's to fix):
`ORDER_FULFILLMENT_PROJECTION_SERVICE_TOKEN` is provided by `ShippingModule` but not exported,
so it is module-private today.

---

## 5. Required plan revisions before implementation

1. **§5 parity spec** — invert the approach per **F-3**: targeted column/index assertion is the
   deliverable; the whole-table diff is an optional time-boxed probe.
2. **§6 tests** — add **T8** and **T9** per **F-4**; make **T4** assert the *persisted* value,
   not the call argument, per **F-1**.
3. **§4.5** — record that `findByOrderId` already exists (**F-5**); the service surfaces it and
   filters by connection caller-side. No new port method.
4. **Steps** — name `buildOrmEntity`, `toDomain` (append at END, 23 positional args) and the
   `Shipment` constructor explicitly (**F-1**).
5. **§4.5** — add the token-name collision check against `shipping.tokens.ts` (**F-6**).

## 6. Invariants baseline (for the gate report)

`check:invariants` on this branch: **63 invocations / 36 distinct scripts**. Note this is **36,
not the 35** carried in the task brief — `scripts/check-contract-suite-not-in-production.mjs`
was added by sibling **#2404** (`3f872f225`, shared port-contract test kit). Flagged rather
than silently matched the expected number.
