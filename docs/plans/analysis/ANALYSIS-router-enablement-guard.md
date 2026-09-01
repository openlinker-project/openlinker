# Pre-Implement Readiness Gate — Router enablement guard + first-run location bootstrap (#2407)

**Plan**: `docs/plans/implementation-plan-router-enablement-guard.md`
**Branch**: `2407-router-enablement-guard`, based on `origin/oms-programme-wave-3a` (compared against that base, not `main`)
**Date**: 2026-08-31
**Verdict**: **NEEDS-REVISION** (GO-WITH-CHANGES)

The architecture is sound and the reuse story is almost entirely correct — every seam the plan claims to
reuse exists with the shape the plan assumes. Two things block a clean start: the `create`-side guard
**breaks three existing integration tests** the plan never mentions, and the plan's §7 test design
**duplicates coverage that already ships** while asserting it in a place that cannot prove anything.
Four smaller corrections follow.

---

## Reuse findings

| Plan artifact | Status | Evidence |
|---|---|---|
| `parseAuthorityConfig(config,'sourcing')` | **EXISTS — reuse as planned** | `libs/core/src/fulfillment-authority/domain/types/authority-config.types.ts:80`; `unknown` first arg, returns `{enabled,isPrimary,scopes}`, never throws, non-record ⇒ `UNHELD`. Key `sourcingAuthority` at `authority-kind.types.ts:109`. Barrel-exported. |
| `ILocationService.listLocations` supplying `total` | **EXISTS — reuse as planned** | `location.service.interface.ts:41-44`; **two required args** `(filters, pagination)`; returns `{items,total,page,limit}` (`location.repository.ts:142-155` `findAndCount`). Plan step 3 already calls it correctly. |
| `createLocation` + `DuplicateLocationCodeError` | **EXISTS — reuse as planned** | `location.service.ts:40-49`; error is raised by the **repository** (`location-repository.port.ts:32`) and propagates through the service. Exported from the barrel at `libs/core/src/inventory/index.ts:53`. |
| `countActiveLocations` | **NEW — confirmed absent** | Repo-wide grep: zero hits. |
| `bootstrapDefaultLocations` / any seed/default-location code | **NEW — confirmed absent** | Zero hits for `bootstrapDefault`, `BOOTSTRAP_LOCATION`, `defaultLocation`, `seedLocation`, `'MAIN'`. D5's "there is no sentinel pool" finding is **correct**. |
| `kind:'warehouse'`, `status:'active'` | **VALID** | `location.types.ts:20-25`, `:36`. |
| `LOCATION_SERVICE_TOKEN` | **EXISTS** | `libs/core/src/inventory/inventory.tokens.ts:20`, exported `inventory.module.ts:233`. |
| Router-enablement / location guard on connection write | **NEW — confirmed absent** | `connection.service.ts` has only `assertNoWriteBackAuthorityConflict:109-120` (capability-based). |
| `selectPrimaryFulfillmentRouter` / `isFulfillmentRouterUnroutable` | **EXISTS** | `authority-resolution.types.ts:624`, `:582`. **Pure functions over `AuthorityClaimantInput[]`** — see F2. |
| `'sourcing-ambiguous'` derived-not-persisted | **ALREADY PINNED** | `authority-attention-reason.types.ts:222` (`producer: null`), pinned by `@ts-expect-error` at `authority-attention-reason.types.spec.ts:384`. AC "not persisted by this change" needs no new test. |
| `features/inventory-locations` (FE) | **NEW — confirmed absent** | No FE locations client/hooks exist anywhere in `apps/web/src`. |
| `router-readiness-panel.tsx` | **NEW — confirmed absent** | Mount site + gating precedent: `pages/connections/connection-detail-page.tsx:348-355` (`CatalogTrustPanel` is capability-gated at `:351-353`). |
| `POST /inventory/locations/bootstrap` | **NEW** | Controller `apps/api/src/inventory/http/inventory-locations.controller.ts:64`; writes are `@Roles('admin')` at `:118,:135,:155`. No route-order conflict (`GET /:id` is GET-only). |
| `router-enablement-guard.int-spec.ts` | **NEW** | Absent. `inventory_locations` (`setup.ts:99`) and `connections` (`setup.ts:251`) are **already** in `tablesToTruncate` — plan step 8's "add if absent" is a no-op. |

---

## Critical findings

### C1 — The `create` guard breaks three shipped integration tests (unhandled regression)

`apps/api/test/integration/authority-status.int-spec.ts` creates connections carrying a
`sourcingAuthority` claim through `POST /v1/connections` **with an empty `inventory_locations` table**
(the harness truncates it per test, `setup.ts:99`):

- `:114` — `createConnection(token,'Claiming shop',{ sourcingAuthority: true })`
- `:133-135` — `createConnection(..., { sourcingAuthority: { enabled: true, isPrimary: true } })`
- `:166-167` — `createConnection(token,'Router A'/'Router B',{ sourcingAuthority: true })`

Under plan §D2 ("`create`: any incoming claim with zero locations is refused"), all three become **400**
and the preview / apply / ambiguity-refusal tests fail. The plan's risk table does not list this, and
§8's backward-compatibility note ("an install that somehow already carries the claim keeps it") does not
cover the create path.

**Migration path** — pick one, explicitly, in the plan:
1. Seed one location in those three tests' arrange blocks (smallest diff, and it makes the fixtures
   honest about the new precondition); **or**
2. Add a location-creating helper to the int-spec's shared setup; **or**
3. Reconsider whether `create` should be guarded at all — the ADR-055-shaped argument that a connection
   is created before any warehouse exists is not addressed in the plan and deserves a sentence either way.

Whichever is chosen, the plan must say so, because silently editing three unrelated shipped tests to make
a new guard pass is exactly the shape a reviewer will (rightly) stop.

### C2 — §7's two-enabled-routers evidence already ships, and its proposed assertion proves nothing

The plan presents §7 as new red-first evidence. It is not new:

- End-to-end already: `authority-status.int-spec.ts:164-185` arranges two `sourcingAuthority` connections
  and asserts `rows.find(q==='sourcing').state === 'ambiguous'` **and**
  `attention.counted[0].reason === 'sourcing-ambiguous'`, then asserts nothing was written.
- Unit already: `libs/core/src/fulfillment-authority/domain/types/fulfillment-router-selection.spec.ts`
  covers no-claimant / inactive / one-holder / multiple-holder across the whole reason set.
- The derived-not-persisted property is pinned at `authority-attention-reason.types.spec.ts:384`.

Worse, the plan's Assert (a)/(b) call `selectPrimaryFulfillmentRouter` **inside an integration spec**.
That function is pure and total over an in-memory `AuthorityClaimantInput[]` (`authority-resolution.types.ts:624`)
— calling it in an int-spec exercises no database, no HTTP and no wiring, so it would pass identically with
the guard absent. It is a unit assertion wearing an int-spec's clothes.

**Migration path**: drop §7's (a)/(b)/(c) as written. If a two-router assertion is still wanted here, make it
the one thing this issue actually changes — that **both** connections can now only be created once a location
exists — and assert it through HTTP, extending `authority-status.int-spec.ts` rather than restating its
existing case in a second file.

---

## Warnings

### W1 — `.eslintrc.js` has ONE slug-enumerating group, not two, and it may not be needed at all
Plan step 9 says "register the slug in **both** `no-restricted-imports` pattern groups". There is one:
`.eslintrc.js:203-314` (the `apps/web/src/features/**` cross-feature list, five parts per slug). The other
three blocks (`:53-69`, `:97-133`, `:158-171`) enumerate no slugs. Note also that the list constrains
**cross-feature** imports: since `features/connections` will import `features/inventory-locations`, the entry
IS required — but describe it as one edit, not two.

### W2 — the UI-vocabulary gate the plan relies on cannot fire on this code
`scripts/check-ui-vocabulary.mjs` `SCAN_ROOTS:151-184` covers only `features/{fulfillment-authority,automation,returns,orders}`.
`features/connections` and a new `features/inventory-locations` are **out of scope**, so the plan's risk-row
claim that the gate protects the panel's copy is inert. The P9 rule still binds the author; the script will
not enforce it. Also, the banned list (`:118-128`) is wider than the plan's three words — it additionally bans
`phase`, `Orchestrator`, `Gateway` and **`holder`** as whole words, which is easy to trip in routing copy.

### W3 — the module wiring step is missing
`ConnectionService` is provided in `apps/api/src/integrations/integrations.module.ts:64-66`, whose `imports`
(`:47-62`) do **not** include any inventory module. Injecting `LOCATION_SERVICE_TOKEN` requires adding
`InventoryModule as CoreInventoryModule` from `@openlinker/core/inventory`. Two notes:
- **Cycle-free**, by the precedent already documented in that file at `:20-23`: core `InventoryModule` imports
  the **core** `IntegrationsModule` (`inventory.module.ts:52`), a different class from the api one, and
  `libs/core` cannot import `apps/api`.
- Do **not** import `apps/api/src/inventory/inventory.module.ts` — it is controller-only and exports nothing
  (`:15-19`), so the token would not be visible.
- `scripts/check-cross-context-imports.mjs` permits all of this: `I*Service` (`:13`), `*_TOKEN` (`:18`) and
  `*Module` for `imports:` (`:16`) are all on the allow surface. No allow-list entry needed.

### W4 — a new admin-gated route touches the permission mirror
`check-permission-mirror.mjs` runs under `check:invariants`. A new `@Roles('admin')` route on
`inventory-locations.controller.ts` should be checked against the permission table it mirrors; the plan lists
no such step. Cheap to verify, expensive to discover at commit time.

### W5 — define "the effective new config" precisely in D2
`ConnectionService.update:663-667` validates **`patch.config` alone**, never merged with `existing.config`,
and passes the patch through to `connectionPort.update:669` as-is. The plan's D2 says the guard compares
"the effective new config" against `existing.config` without saying what that resolves to for a patch that
omits `config`. `patch.config ?? existing.config` fails safe (a config-less patch yields `previous === next`,
so no transition); anything else needs stating. Write the rule down — this is the exact ambiguity that
produced the "tested against the PERSISTED status" docblock the plan is copying.

---

## Open questions

1. **Does satisfying the precondition actually unblock routing?** The minted `MAIN` row attaches no positions
   (`locationId` stays `NULL`), and `inventory-location.entity.ts:17-19` states that a NULL `locationId`
   permanently means "the master declines to locate its stock" and that **no row is ever a stand-in for it**.
   So after the bootstrap the guard passes while every line may still be `unfulfillable`. The plan's risk table
   acknowledges this and defers it, which is defensible — but the panel copy must say it plainly, and the plan
   should cite that docblock, because a reviewer will reach for it as an objection to D5.

2. **A future *enabling* preset would swallow the guard's 400.** `AuthorityStatusService.applyPreset:171` calls
   `ConnectionService.update` inside a per-connection `try/catch` that records a `failedConnectionIds` entry and
   logs (`:172-181`). Today's presets only ever *disable* (`authority-presets.ts:129-153`), so the guard cannot
   fire on that path and there is no live defect — but the interaction is worth one line in §8 so the next preset
   author knows the refusal will not surface as a refusal.

3. **`#2408` reconciliation** — the plan's §5 finding (ADR-054 puts routing rules in `oms_routing_rules`, while
   #2408 still specifies a `Connection.config.routing` coercer) is correct and correctly routed elsewhere. It is
   not a blocker here; make sure it is actually filed against #2408 rather than only living in this plan.

---

## Backward-compatibility summary

| Surface | Assessment |
|---|---|
| Top-level barrels | **Safe** — additive exports only (`libs/core/src/inventory/index.ts`). |
| Port signatures | **Safe** — `LocationRepositoryPort` is explicitly unchanged; two additive `ILocationService` methods. |
| DTO shapes | **Safe** — one new response DTO, no existing field removed or retyped. |
| Symbol tokens | **Safe** — none added, renamed or removed. |
| ORM schema | **Safe** — no migration; `check-migration-timestamps` not engaged. |
| `check:invariants` | **W4** (permission mirror) is the only realistic trip. Capability / authority-kind / attention-reason mirrors are untouched, as the plan claims. |
| **Runtime behaviour of existing tests** | **C1 — BREAKS** three cases in `authority-status.int-spec.ts`. |

---

## Verdict rationale

One Critical regression (C1) and one major reuse collision (C2), both fixable inside the existing design with
no architectural change — the layering, the boundary analysis, the no-`CoreCapabilityValues` decision, the
insert-then-recover idempotency and the "no sentinel pool" finding are all correct and confirmed against the
tree. **NEEDS-REVISION**: address C1 and C2 explicitly in the plan, fold in W1-W5, then implement.
