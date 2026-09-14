# Pre-Implementation Analysis: Wire `resolveFulfillmentRouter` (#2408, + #2869 R7)

**Date**: 2026-09-06
**Plan**: `docs/plans/implementation-plan-wire-fulfillment-router.md`
**Gate**: read-only readiness (`/pre-implement`) — no code written, plan not edited.

## Verdict: **READY** — with three factual corrections to make before coding

No Critical contract break. No reuse collision. Two of the corrections are one-line
edits to the plan's own prose (its §4.3/Q1 rationale and its Phase-4 import list); the
third is a naming constraint the plan does not currently state.

---

## 1. Reuse audit

| Plan artifact | Status | Evidence |
|---|---|---|
| `checkManualRouteAdmissible` | **NEW (confirmed absent)** | repo-wide grep: hits only in the plan itself |
| `ManualRouteAdmissibility` / `ManualRouteRefusalReasonValues` | **NEW** | same |
| `FulfillmentRouterResolverPort` | **NEW** | only prior mention is `docs/plans/implementation-plan-fulfillment-ingestion-intercept.md:196,332` (where it was *proposed and rejected* as premature) |
| `FULFILLMENT_ROUTER_RESOLVER_TOKEN` | **NEW, genuinely unbound** | zero hits for `ROUTER_RESOLVER` / `RouterResolver` across the tree |
| `createOmsFulfillmentRouterResolver` | **NEW** | same |
| `OlFulfillmentRouter` / `createOlFulfillmentRouter` | **ALREADY EXISTS → reuse (as planned)** | `libs/oms/src/routing/ol-fulfillment-router.ts:58` — deps `{connectionId, rules, locations, inventory, works, now?}` match §6 step 6 exactly |
| `OMS_PLATFORM_TYPE` | **ALREADY EXISTS → reuse** | `libs/oms/src/oms.constants.ts:32` (`'openlinker'`), barrel-exported `libs/oms/src/index.ts:38` |
| An existing admissibility/refusal primitive R7 should reuse instead | **None found** | the nearest shapes (`AuthorityResolution`, `SalesDocumentBlockOutcome`, `RoutingDecisionAbandonReason`) answer different questions; `RoutingCommitService.refusalFor` (`routing-commit.service.ts:306`) is a *plan* refusal, not a *manual-route* one. Adding a new closed union is correct. |
| `RoutingDecision` (R7's argument type) | **EXISTS, same context** | `libs/core/src/fulfillment/domain/entities/routing-decision.entity.ts:17` |

---

## 2. Backward-compatibility findings

### Barrel removal — `resolveFulfillmentRouter` (Warning, not Critical)

`libs/core/src/orders/index.ts:221` exports it. Complete consumer set (production **and** test):

| File | Line | Kind |
|---|---|---|
| `libs/core/src/orders/application/services/order-ingestion.service.ts` | 88 (import), 819 (call), 576 (comment) | production, in scope |
| `apps/worker/src/sync/handlers/fulfillment-work-route.handler.ts` | 85 (import), 133 (call), 22 (comment) | production, in scope |
| `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` | 45-50 (`jest.mock`), 2148, 2191, 2297 | test, in scope |

**Nothing out of scope depends on it.** No plugin, no other app, no integration test. Removal is
safe. The plan's Phase-3 step 9 already enumerates all three. Note the four characterisation call
sites are three `mockResolvedValue` lines (2148, 2191, 2297) plus the mock declaration — the plan's
"four tests" count is consistent with the two blocks at ~2018 and ~2296.

`scripts/check-cross-context-imports.mjs` now stale-checks its `ALLOW_LIST`; none of the deleted
paths appear there, so deletion will not trip it.

### No other contract surface is touched

No port signature change, no DTO change, no token removal, **no migration** (verified:
`1871000000000` is unused; the highest fulfillment block is `1870000004000`).

---

## 3. The `@Global()` + `@Optional()` design — sound, with one import-list defect

**Sound.** `OrderIngestionService` is declared in `OrdersModule`
(`libs/core/src/orders/orders.module.ts`), whose injector resolves its own providers, its imports,
and any `@Global()` provider. Nothing anywhere binds `FULFILLMENT_ROUTER_RESOLVER_TOKEN`, so **no
nearer binding can shadow it** — the plan's Alternative-2 rejection is correct on Nest semantics.

The `@Global()` precedent is real and of the right shape:
- `libs/plugin-sdk/src/rate-limit.module.ts:66` — `@Global()`, imported at
  `apps/api/src/integrations/integrations.module.ts:65` (a mid-level feature module, **not**
  AppModule), and its tokens are injected by services in deeper modules that never import it.
- `libs/shared/src/cache/cache.module.ts:12` — `@Global()`, imported at
  `apps/api/src/app.module.ts:73` and `apps/worker/src/app.module.ts:62`.

**Defect (IMPORTANT) — Phase 4 steps 10/11 name the wrong module to import.**
The plan says the binding module imports *"`PluginRegistryModule` (for `ROUTING_RULE_SOURCE_TOKEN`)"*.
`PluginRegistryModule` is `@Module({})` (`libs/core/src/integrations/plugin-registry.module.ts:24`) —
importing the **bare class** yields an empty module and the token will **not** resolve. The binding
module must import the host's own `IntegrationsModule` wrapper, which imports
`PluginRegistryModule.forRoot({plugins})` and re-exports it:
- api: `apps/api/src/integrations/integrations.module.ts:66` + `exports:` at `:103`
- worker: `apps/worker/src/integrations/integrations.module.ts:26-27`

(Importing `PluginRegistryModule.forRoot(...)` a second time would also be wrong — it would build a
second plugin graph.)

**Minor**: the `@Global()` module must also list the token in its `exports`, not only `providers`.
The plan says "providing … via `useFactory`" and does not mention exporting it.

---

## 4. Question 4 — does `PluginRegistryModule.forRoot` really re-export `ROUTING_RULE_SOURCE_TOKEN`? **Yes.**

- `libs/oms/src/oms.module.ts:63,65` — `OmsModule.register()` provides
  `{provide: ROUTING_RULE_SOURCE_TOKEN, useExisting: OmsRoutingRuleRepository}` and
  `exports: [ROUTING_RULE_SOURCE_TOKEN, adapterModule]`. Token: `libs/oms/src/oms.tokens.ts:16`.
- `libs/core/src/integrations/plugin-registry.module.ts:36,38` — `imports: options.plugins`,
  `exports: options.plugins`.
- `options.plugins` contains the `OmsModule.register()` **DynamicModule instance**:
  `apps/api/src/plugins.ts:77`, `apps/worker/src/plugins.ts:81`. Because both arrays are
  module-level `const`s, the same object identity is imported and exported — Nest's module
  re-export therefore makes `ROUTING_RULE_SOURCE_TOKEN` resolvable to any module importing
  `PluginRegistryModule` (and, transitively, the host `IntegrationsModule`).

---

## 5. Question 5 — the three service tokens exist and are exported

| Service | Token | Declared | Exported by |
|---|---|---|---|
| `ILocationService` | `LOCATION_SERVICE_TOKEN` | `libs/core/src/inventory/inventory.tokens.ts:20` | `InventoryModule` (`inventory.module.ts:231`) |
| `IInventoryQueryService` | `INVENTORY_QUERY_SERVICE_TOKEN` | `libs/core/src/inventory/inventory.tokens.ts:16` | `InventoryModule` (`inventory.module.ts:229`) |
| `IFulfillmentWorkQueryService` | `FULFILLMENT_WORK_QUERY_SERVICE_TOKEN` | `libs/core/src/fulfillment/fulfillment.tokens.ts:51` | `FulfillmentModule` (`fulfillment.module.ts:108`) |
| connection read | `CONNECTION_PORT_TOKEN` (`ConnectionPort`) | `libs/core/src/identifier-mapping/identifier-mapping.tokens.ts:15` | `IdentifierMappingModule` (`identifier-mapping.module.ts:61`) |

Note `CONNECTION_SERVICE_TOKEN` / `IConnectionService` is **apps/api-only**
(`apps/api/src/integrations/application/interfaces/connection.service.interface.ts:23`) and is
therefore unusable from `libs/oms` or from the worker. `ConnectionPort` is the correct choice, and
it is the one `FulfillmentWorkRouteHandler` already injects
(`fulfillment-work-route.handler.ts:80`).

---

## 6. `pnpm check:invariants` — nothing planned trips it

| Script | Verdict | Note |
|---|---|---|
| `check-cross-context-imports.mjs` | **PASS** | `libs/oms/src` is a walked root (`:80`) classified `kind:'product'` (`:673`) with no same-context skip. `ConnectionPort` matches `ALLOW_PATTERNS` `/Port$/` (`:559-566`); only `*RepositoryPort` is denied (`:552-557`). No `ALLOW_LIST` entry needed. Precedent already in tree: `libs/oms/src/oms.plugin.ts:17` imports `Connection` from that barrel. |
| `check-workspace-dep-declarations.mjs` | **PASS** | `@openlinker/core` already in `libs/oms/package.json` `dependencies`; `@openlinker/oms` already in **both** `apps/api/package.json:56` and `apps/worker/package.json:40`, with tsconfig paths at `apps/api/tsconfig.json:35-36` / `apps/worker/tsconfig.json:38-39`. Fully derived script — no list to extend. |
| `check-service-interfaces.mjs` | **N/A** | scoped to `libs/core/src/**/application/services/*.service.ts` (`:36,72-79`). A `*.port.ts`, a `*.types.ts` and `libs/oms/**/*.resolver.ts` are all out of scope. |
| `barrel-purity.spec.ts` (Jest, not `check:invariants`) | **PASS, with a constraint** | the `fulfillment` leaf's allow-set is `['@openlinker/core/fulfillment-authority','@openlinker/core/order-lifecycle']` (`:214-220`). `RoutingDecision` lives **inside** `fulfillment`, so R7 needs only a relative import. **Constraint: R7 and the new port must import `RoutingDecision` / `FulfillmentRouterPort` relatively, never via `@openlinker/core/fulfillment`.** |
| `check-no-injection-contracts.mjs` | **PASS, with a constraint** | registers `libs/core/src/fulfillment` with `forbidden: ['@openlinker/core/orders','@openlinker/core/inventory']` (`:138-140`). Neither new core file may import either barrel. |
| `check-jest-integration-mappers.mjs` | **PASS** | `@openlinker/oms` already in `REQUIRED_BASE` (`:69`); both apps already map bare + `/(.*)` — `apps/api/test/jest-integration.cjs:50-51`, `apps/worker/test/jest-integration.cjs:43-44`. A new `libs/oms/src/routing/*.ts` resolves through the existing subpath rule. |
| `check-contract-suite-not-in-production.mjs` | **PASS** | provided no new file imports `@openlinker/core/fulfillment/testing`. |
| `check-architecture-gates.mjs` | **PASS, with a naming constraint** | the `config-knobs` gate counts exported `read*`/`parse*` helpers in a domain `*.types.ts` that coerce `Connection.config`; four exist and the **fifth fails the build** (`:24-40`). `checkManualRouteAdmissible` is `check*` and takes a `RoutingDecision`, so it does not count — **but the file must not name a helper `read*`/`parse*` nor reference `Connection.config`.** The plan does not state this. |
| `check-migration-timestamps.mjs` | **N/A** | no migration added. |

---

## 7. Question 7 — host module locations

- AppModules: `apps/api/src/app.module.ts`, `apps/worker/src/app.module.ts`.
- **`apps/api/src/fulfillment/` ALREADY EXISTS** — `fulfillment-api.module.ts`,
  `http/fulfillment-work.controller.ts`, `http/dto/`; registered at `apps/api/src/app.module.ts:114`.
  Adding `fulfillment-router-binding.module.ts` beside it is fine, but the plan should say whether
  the binding is a *new* module or belongs on the existing `FulfillmentApiModule` (a new `@Global()`
  module is the safer read, since `FulfillmentApiModule` is a controller module).
- **`apps/worker/src/fulfillment/` does NOT exist** — new directory.

---

## 8. Findings against the plan's own claims

### Verified correct
- §4.3 *"`OrdersModule` already imports `FulfillmentModule` and `InventoryModule`"* — **true**:
  `orders.module.ts:115` and `:84`.
- §4.3 *"the worker's `AppModule.forRoles` already carries both in its SHARED array"* — **true**:
  `apps/worker/src/app.module.ts:67` (Inventory) and `:73` (Fulfillment), both above
  `...roles.map(...)` at `:74`.
- §4.4 the `RoutingCommitService` refusal trap — **true**: `routing-commit.service.ts:322,325`
  return `plan-carries-holds` / `plan-carries-unfulfillable`.
- §2 *"nothing enqueues `fulfillment.work.dispatch`"* — **true**: only the handler
  (`sync-worker.module.ts:77`), the registration (`handler-registration.service.ts:531`) and the
  `JobTypeValues` entry (`sync-job.types.ts:189`).
- §2 *"the `1871000000000` block is unused"* — **true**.
- §1's correction (no manual-route producer exists on `main`) — **true**: grep returns hits only
  inside the spec document.

### **FALSE — Q1's stated rationale (IMPORTANT)**

Q1 argues SHARED placement because *"`OrdersModule` is itself shared, so a `jobs`-only binding
would make `OrderIngestionService` degenerate in one role and live in another."*

**`OrdersModule` is not in the worker's SHARED array.** It is imported only by `SyncWorkerModule`
(`apps/worker/src/sync/sync-worker.module.ts:90`), which is the `jobs` role's module
(`app.module.ts:44`). `FulfillmentWorkRouteHandler` is likewise declared there
(`sync-worker.module.ts:160`). So in the worker, **both** call sites exist only under `jobs`, and a
`jobs`-only binding would produce no split answer at all.

The *conclusion* (SHARED) remains defensible — it is one provider, adds no context module, and
keeps the placement symmetric with the api — but the reason must be restated, or a future reader
will act on a false premise about the worker's module graph.

---

## 9. Open questions / things to settle before coding

1. **Phase 4 import list** — replace `PluginRegistryModule` with the host `IntegrationsModule`
   wrapper in both binding modules, and export the token from the `@Global()` module.
2. **Q1 rationale** — restate on the true worker graph (see §8).
3. **Naming constraint** — record in the plan that R7's file must avoid `read*`/`parse*` exports
   and must not reference `Connection.config` (`check-architecture-gates.mjs` config-knobs gate is
   at 4 of 4), and that both new core files must use *relative* imports for own-context types.
4. **A1's `platformType` check needs a `ConnectionPort` read** — the plan lists `connections` in
   `deps` but does not name the token; it is `CONNECTION_PORT_TOKEN` / `ConnectionPort` from
   `@openlinker/core/identifier-mapping`, and `IConnectionService` is **not** available (api-only).
5. **`apps/api/src/fulfillment/` already exists** — state whether the binding is a new sibling
   module (recommended) or an addition to `FulfillmentApiModule`.
6. **Not blocking**: R7 ships with no caller. The plan argues this openly (§6 Phase 1) and the
   argument is the right one; recording it here so the reviewer is not surprised.
