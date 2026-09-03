# PRE-IMPLEMENT gate — #2408 (OL fulfilment router)

**Plan**: `docs/plans/implementation-plan-ol-fulfillment-router.md`
**Date**: 2026-08-31 · **Mode**: read-only readiness gate (no source edited)
**Verdict**: **GO-WITH-CHANGES** — no reuse collision, no contract break of a
published symbol, but **six** concrete plan gaps, two of which (R2, R4) will
fail `pnpm lint` / the int harness if implemented exactly as written.

---

## 1. Reuse audit — does it already exist?

| Plan artifact | Status | Evidence |
|---|---|---|
| `FulfillmentRouterPort` implementer | **NEW — confirmed absent.** Only fixtures + a `jest.Mocked` implement it; `resolveRouter()` is still `null`. | `libs/core/src/fulfillment/testing/__tests__/routers.fixtures.ts:63` (`ConformingRouter`); `libs/core/src/fulfillment/application/services/__tests__/routing-commit.service.spec.ts:73`; `apps/api/test/integration/routing-commit.int-spec.ts:146-148`; `apps/worker/src/sync/handlers/fulfillment-work-route.handler.ts:245` |
| `RoutingFilterName` / `RoutingSortName` / `RoutingAfterAction` | **NEW — zero hits in code.** Only plan + design prose. | grep over `libs apps scripts`: hits only in `docs/plans/**` |
| `coerceRoutingRules` / `isRoutingRule` / `OlFulfillmentRouter` | **NEW — zero code hits.** | ditto |
| `oms_routing_rules` table | **NEW.** Named only in prose, and the prohibition is already in code. | `libs/core/src/fulfillment-authority/domain/types/authority-config.types.ts:12`; `docs/architecture/adrs/054-…:56` |
| `RoutingExplanationStep`, `RoutingAssignment`, `RoutingUnfulfillableLine`, `checkRoutingPlanConservesQuantities` | **ALREADY EXISTS → reuse verbatim.** | `libs/core/src/fulfillment/domain/types/routing.types.ts:128,149,179,270` |
| Blocking-rejection model | **ALREADY EXISTS**, incl. `orderId` denormalised for exactly this read. | `libs/core/src/fulfillment/domain/types/fulfillment-work-rejection.types.ts:23-49` (see R1) |
| `ILocationService` (candidate locations) | **EXISTS + barrel-exported.** | `libs/core/src/inventory/index.ts:90`; token `libs/core/src/inventory/inventory.tokens.ts:20` |
| Naming-collision risk with `mappings`' `fulfillment_routing_rules` | **REAL, and already documented in-code.** Plan's mitigation (the `oms_` prefix, no join) matches the shipped docblock. | `libs/core/src/fulfillment/domain/ports/fulfillment-router.port.ts:8-16` |

**No reuse collision.** Every artifact the plan proposes to build is genuinely absent.

---

## 2. Contract-surface findings

### R1 — `IFulfillmentWorkQueryService`: the blast radius is SMALL, but the plan's Phase 0 is INCOMPLETE (blocking-ish)

Full implementer/mock census (`grep -rn "IFulfillmentWorkQueryService\|FULFILLMENT_WORK_QUERY"`):

| Site | Kind | Breaks on adding a method? |
|---|---|---|
| `libs/core/src/fulfillment/application/services/fulfillment-work-query.service.ts:21` | the one real implementer | **YES — must implement it** |
| `libs/core/src/fulfillment/application/interfaces/fulfillment-work-query.service.interface.ts:31` | the interface | edited by design |
| `libs/core/src/fulfillment/fulfillment.module.ts:81,95` | DI binding + export | no |
| `libs/core/src/fulfillment/index.ts:134` | barrel `export type` | no (additive) |
| `libs/core/src/fulfillment/fulfillment.tokens.ts:51` | token | no |
| `libs/core/src/shipping/application/services/shipment-dispatch.service.ts:108-109` | **consumer** (injects the interface) | no |
| `libs/core/src/shipping/application/services/fulfillment-status-sync.service.ts:192-193` | **consumer** | no |
| `libs/core/src/fulfillment/application/services/fulfillment-work-query.service.spec.ts` | spec for the real service | no (adds cases) |

**There is no hand-rolled object-literal test double of this interface anywhere** — both shipping consumers are mocked at the service level; no `implements IFulfillmentWorkQueryService` fake exists. So the additive method breaks **exactly one** file. That is the good news.

**The gap**: plan §6 Phase 0 says "add … to `IFulfillmentWorkQueryService` + its service". But `FulfillmentWorkQueryService` reads through `FulfillmentWorkRepositoryPort`, whose only rejection read is **`workId`-keyed**:

- `libs/core/src/fulfillment/domain/ports/fulfillment-work-repository.port.ts:264` — `listBlockingRejections(workId: string)`

There is **no order-keyed rejection read on the port**. So Phase 0 is really **three** edits, not two:
1. a new `FulfillmentWorkRepositoryPort` method (order-keyed), 2. its `FulfillmentWorkRepository` implementation, 3. the service + interface method.
The denormalised `orderId` column exists precisely so this is one line of SQL — see the field's own docblock at `fulfillment-work-rejection.types.ts:26-33`, which anticipates this read. Alternatively the service can fan out `findByOrderId` → `listBlockingRejections(workId)` per work, which needs **no** port change; the plan must pick one and say so.

**Required plan change**: rewrite Phase 0 step 1 to name the repository-port half explicitly (or state the fan-out alternative and why). As written it under-scopes the change and will surprise the implementer mid-flight.

### R2 — `libs/oms` cannot persist anything today: no `typeorm` dependency, and `OmsModule` is a `DynamicModule` shim (BLOCKING for Phase 2)

- `libs/oms/package.json:31-35` — `dependencies` are exactly `@openlinker/core`, `@openlinker/plugin-sdk`, `@openlinker/shared`. **No `typeorm`, no `@nestjs/typeorm`.** The Allegro precedent declares both: `libs/integrations/allegro/package.json:39,41`.
- `libs/oms/src/oms.module.ts:36-39` — `OmsModule.register()` returns `createNestAdapterModule({ plugin: createOmsPlugin() })`. There is **no `TypeOrmModule.forFeature`** seam. Allegro's is at `libs/integrations/allegro/src/allegro-integration.module.ts:89`.
- Consequence for the int harness: schema is built by `autoLoadEntities + synchronize` (`apps/api/src/app.module.ts:86-88`), so an ORM entity that is never `forFeature`-registered simply **does not exist** in the test database — and the failure reads as "relation does not exist", not as a missing registration.

**Required plan change**: add an explicit Phase-2 step — convert `OmsModule` from the `createNestAdapterModule` shim to a hand-written `@Module` (the Erli #1198 conversion the plugin's own docblock already names, `libs/oms/src/oms.plugin.ts:97-101`), declare `typeorm` + `@nestjs/typeorm`, and `TypeOrmModule.forFeature([OmsRoutingRuleOrmEntity])`. Note this is the SAME conversion Phase 4 step 9 needs for `OmsPluginDeps` injection, so do it once — and note ADR-051's warning in `oms.plugin.ts:86-96` about which worker roles the imported modules then reach.

### R3 — plugin-shipped migration: exact steps and the current timestamp ceiling

Precedent is Allegro, and it is a **three-file** registration:

1. Migration file at `libs/oms/src/migrations/<13-digit>-<name>.ts`, class name suffixed with the same 13 digits (`scripts/check-migration-timestamps.mjs` invariants 1–3, header lines 25-33).
2. Add `'libs/oms/src/migrations'` to `PLUGIN_MIGRATION_DIRS_FROM_REPO_ROOT` in `apps/api/src/plugin-migrations.ts:33-35`.
3. Add the **same** string to `scripts/plugin-migration-dirs.json` `directories`. The two are equality-checked; drift fails `pnpm lint` (`plugin-migrations.ts:14-16`).

**Current max timestamp across the repo: `1869000000000`** (`apps/api/src/migrations/`; the sole plugin migration `libs/integrations/allegro/src/migrations/1767900000000-…` is far below). Invariant 4 requires a new migration to be **strictly greater than every migration on `origin/main`**, so the next free synthetic prefix is `1870000000000` — the plan's "next free after `1869000000000`" is correct as of this gate, and its own §8 warning to re-verify before push stands.

**Also note**: `apps/api/src/database/data-source.ts:63` scopes entity discovery to `libs/core/src/**/*.orm-entity{.ts,.js}` — a `libs/oms` entity is **invisible to the TypeORM CLI**, so `migration:generate` will not see it. The migration must be **hand-written**. The plan does not say this; it should.

### R4 — the new table must join `tablesToTruncate`, and the plan points at the wrong artifact (BLOCKING)

The reset list is `apps/api/test/integration/setup.ts:75` (`tablesToTruncate: [...]`), consumed by `libs/test-kit/src/harness.ts:281-287`. Two things the plan misses:

- `oms_routing_rules` will carry **no ORM foreign key to `connections`** if it follows the `inventory_locations` precedent, and the harness's CASCADE-closure walk (`libs/test-kit/src/harness.ts:80-138`) only reaches tables with a real FK. The `inventory_locations` comment at `setup.ts:91-100` documents exactly this trap: an unlisted, FK-less table leaks rows into the next case and collides on its unique index — which is precisely the `(connectionId, kind, name)` partial-unique the plan proposes. **List it explicitly, with a comment saying why.**
- The **worker** harness (`apps/worker/test/integration/harness.ts` / `setup.ts`) has its own config; if any worker int-spec touches the table it must be listed there too.

### R5 — `libs/oms` import surface: what is allowed, and one thing that is not

- `check-cross-context-imports.mjs` walks `libs/oms/src/**` as a first-party product package (`scripts/check-cross-context-imports.mjs:41,706-707`), applying the same allow/deny shapes as a plugin: `I*Service`, `*_TOKEN`, `*Port` (single suffix), guards, entities, exceptions, `*Module` — and **denies `*RepositoryPort`, `*OrmEntity`, `*Adapter`, `*Dto`**. `libs/oms` has **no `ALLOW_LIST` entry**, so any such import fails the build with no exemption available.
  → The plan's Phase 3 facts loader must reach `IInventoryQueryService`, `ILocationService`, `IFulfillmentWorkQueryService` — all `I*Service`, all **allowed**. ✅
- ESLint bans deep paths for `libs/oms/**/*.ts`: `@openlinker/core/*/{domain,application,infrastructure}/**`, `*/orm-entities`, `*/*.tokens` (`.eslintrc.js:794-820`). Top-level barrels only. ✅ for everything the plan needs — but note `checkRoutingPlanConservesQuantities` and `RoutingExplanationStep` are barrel-exported (`libs/core/src/fulfillment/index.ts:63-64`), so import them from `@openlinker/core/fulfillment`, never the type file.
- `check-outbound-http.mjs:68` lists `libs/oms` as a scan root and `.eslintrc.js:632` bans bare `fetch` there. The plan's constraint note is accurate.
- `check-workspace-dep-declarations.mjs` walks `libs/*` (line 38); adding a **third-party** dep (`typeorm`) is unconstrained by it, but any new `@openlinker/*` edge must be declared in `libs/oms/package.json` **and** mirrored in `libs/oms/tsconfig.json` `references`.
- `check-libs-build-scripts.mjs:39` — `libs/oms` already has `"build": "tsc -b"` (`package.json:19`). ✅ no action.
- `check-jest-integration-mappers.mjs:69` already requires `@openlinker/oms` in every int-jest mapper. ✅ no action.
- `check-no-injection-contracts.mjs:79-123` **explicitly exempts** `libs/oms` and names `createOmsPlugin({inventoryQuery, orderRecords, products, shipping, mappingConfig})` as the reason. Widening `OmsPluginDeps` is therefore sanctioned — but see R6.

### R6 — `OmsPluginDeps`: every construction site, and the required-vs-optional trap

`createOmsPlugin` construction sites (`grep -rn "createOmsPlugin"`):

| Site | Call | Breaks if a dep becomes required? |
|---|---|---|
| `libs/oms/src/oms.module.ts:38` | `createOmsPlugin()` — **no args** | **YES**, if `deps` stops being optional |
| `libs/oms/src/__tests__/oms-plugin.spec.ts:42,46,53,58,68` | five `createOmsPlugin()` calls, no args | **YES** (×5) |
| `apps/api/src/plugins.ts:42` / `apps/worker/src/plugins.ts:43` | import `OmsModule` only — never call the factory | no |
| `apps/worker/test/integration/oms-module-boot.int-spec.ts:39` | boots `OmsModule` | indirectly, via `oms.module.ts` |

`OmsPluginDeps` is declared at `libs/oms/src/oms.plugin.ts:91-97` and the signature is `createOmsPlugin(_deps?: OmsPluginDeps)` (`:112`). **Adding a FIELD to `OmsPluginDeps` breaks nothing** — the parameter is optional and no caller passes it. What breaks is making `deps` **required**, which R2's `@Module` conversion naturally pushes toward.

**Required plan change**: state that `deps` stays optional (the router factory is exported separately per Phase 4 step 9, so the plugin descriptor need not require them), or budget for updating `oms.module.ts` + all five spec calls. The plan's §8 merge-conflict warning about `#2409` in `oms.plugin.ts` is well-founded and should be kept.

### R7 — the contract kit: import path, signature, and the quarantine guard

- **Import path**: `@openlinker/core/fulfillment/testing`, exported at `libs/core/package.json:72-76`; re-exported from `libs/core/src/fulfillment/testing/index.ts:22`.
- **Signature** (`libs/core/src/fulfillment/testing/fulfillment-router-contract.suite.ts:438-441`):
  ```ts
  runFulfillmentRouterContract(
    makeRouter: () => FulfillmentRouterPort,
    options: { readonly subject?: string } = {},
  ): void
  ```
  Note `makeRouter` is **synchronous** and is called once inside `beforeAll`. The plan's `runFulfillmentRouterContract(() => createOlFulfillmentRouter(fakes))` matches. Reference usage: `libs/core/src/fulfillment/testing/__tests__/fulfillment-router-contract.spec.ts:58`.
- **`scripts/check-contract-suite-not-in-production.mjs` DOES constrain where it may be imported from**: it scans `libs/` and `apps/` (line 65) and fails on any **non-test** file importing a specifier containing `fulfillment/testing` (lines 89-105). `isTestFile` recognises `.spec.ts` (line 104). So the call MUST live in a `*.spec.ts` — never in a helper, fixture module, or barrel under `libs/oms/src/routing/`.
- `libs/oms`'s jest `moduleNameMapper` (`libs/oms/jest.config.mjs`: `^@openlinker/core/(.*)$ → ../core/src/$1`) resolves the subpath to source. ✅ no config change needed.

### R8 — a new `libs/oms/src/routing/**` directory: what it trips

Nothing structural, provided the above hold. Checked: `check-outbound-http` (root already covers it), the bare-`fetch` ESLint ban (already covers `libs/oms/**`), `check-cross-context-imports` (already walks `libs/oms/src/**`), `check-libs-build-scripts` (package-level, satisfied), `check-jest-integration-mappers` (already requires the mapper), `check-no-injection-contracts` (explicitly exempts `libs/oms`), `check-contract-suite-not-in-production` (satisfied by keeping the call in a `.spec.ts`), `check-service-interfaces` (scopes to `libs/core/src/**/application/services/*.service.ts` — does **not** reach `libs/oms`). Note two conventions that DO apply: `libs/oms/jest.config.mjs` `testMatch` is `src/**/*.spec.ts`, so specs must be colocated under `src/`; and the `*.types.ts` pure-rule exception the plan invokes for `coerceRoutingRules` is legitimate (`docs/engineering-standards.md § "The pure-rule exception to 'types only' (#2231)"`).

---

## 3. Verdict

**GO-WITH-CHANGES.** No reuse collision; no published symbol is removed, renamed or retyped; the one interface widening (R1) touches a single implementer and zero test doubles. Merge these six changes into the plan before coding:

1. **R1** — Phase 0 is three edits, not two: name the `FulfillmentWorkRepositoryPort` order-keyed rejection read (or the `findByOrderId` fan-out alternative) explicitly. `listBlockingRejections` is `workId`-keyed today (`fulfillment-work-repository.port.ts:264`).
2. **R2 (blocking)** — add a Phase-2 step converting `OmsModule` to a hand-written `@Module` with `TypeOrmModule.forFeature`, and declare `typeorm` + `@nestjs/typeorm` in `libs/oms/package.json`. Neither exists today.
3. **R3** — state that the migration is **hand-written** (`data-source.ts:63` scopes entity discovery to `libs/core`, so `migration:generate` cannot see the entity), and record the three registration files. Next free prefix as of this gate: **`1870000000000`**.
4. **R4 (blocking)** — name `apps/api/test/integration/setup.ts:75` as the truncate list, and require an explicit entry with an FK-less-table comment (the `inventory_locations` precedent at `setup.ts:91-100`); check the worker harness too.
5. **R6** — state that `createOmsPlugin(_deps?)` stays optional-arg, or budget the six call-site updates (`oms.module.ts:38` + five in `__tests__/oms-plugin.spec.ts`).
6. **R7** — pin `runFulfillmentRouterContract` to a `*.spec.ts` file; `check-contract-suite-not-in-production.mjs` fails the build if it is reached from any non-test path.

Plan §5's two adjudicated findings (B1 dropped to #2736, B2 approved) are consistent with the tree as merged, and the `RoutingExplanationStep` / conservation-helper reuse is correct.

---

## 4. Note for the orchestrator — uncommitted WIP already in this worktree

`libs/oms/src/routing/` is **untracked but non-empty** in this worktree at gate time:
`routing-vocabulary.types.ts`, `routing-rule.types.ts`, `routing-rule.types.spec.ts` (Phase 1).
This gate did not read, run, review or modify them. If that WIP is intended, re-run the gate's
R1/R2/R4/R6 items against it before the Phase-2 work begins.
