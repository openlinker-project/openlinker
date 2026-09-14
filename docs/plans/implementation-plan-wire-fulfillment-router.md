# Implementation Plan: Wire `resolveFulfillmentRouter`, preceded by R7

**Date**: 2026-09-06
**Status**: Ready for Review
**Estimated Effort**: ~1.5 days
**Issues**: #2408 (router wiring), #2869 R7 (the live-decision refusal), #2942 (gate — being amended)

---

## 1. Task Summary

**Objective**: make OpenLinker's own fulfilment router reachable, so an operator can turn
OMS routing on; and, *before* that, ship #2869's R7 as a permanent refusal primitive.

**Context**: `resolveFulfillmentRouter` returns `null` unconditionally.
`libs/oms/src/routing/ol-fulfillment-router.ts` is built, specced and barrel-exported as
`createOlFulfillmentRouter`, and **nothing calls it**. Epic #2412 (Wave 3a) is closed 22/22, yet
its exit criterion is not reachable on `main`, and Wave 3b's pack bench is a client of work
objects that are never created.

**Classification**: CORE (a new port + token) + Product package (`libs/oms`) + App (host wiring)
+ Testing.

### Where R7 sits relative to this change

§ 5.1 of `docs/specs/product-spec-manual-bench-routing.md` gates R7 ahead of the wiring. The gate
reads correctly and is honoured here; one observation is worth recording, because it changes who
must act next.

The hazard needs **two** producers of `FulfillmentWork` for one order. Today there are none: a
repo-wide search for a manual-route producer (`routeManually`, `ManualRoute`,
`routedBy`/`decidedBy`, `route-to-bench`) returns hits **only** inside the spec document itself,
#2869 is open and unimplemented, and `RoutingDecision.routerConnectionId` is still a non-null
`string`, so no column can record a person's decision. The spec is written from #2869's
viewpoint — its slice landing first, with the router wiring as the arming edit (§ 5.1 reason 2:
*"a one-line edit somebody could accept in an unrelated PR"*, which **this PR is**). In the actual
ordering the router lands first, so the commit that arms the hazard is **#2869's producer**.

§ 5.2 already grants that R7 ships unreachable (*"R7 stays in, deliberately, even though it is
unreachable on `main`"*), so this is not a correction to the spec — it is a note about which issue
now owns the arming edit, recorded on #2869 and #2408 so the guard is not left aimed at a PR that
has already shipped it.

---

## 2. Scope & Non-Goals

### In scope

1. **R7** — a pure `checkManualRouteAdmissible(live: RoutingDecision | null)` in
   `libs/core/src/fulfillment/domain/types/`, returning a closed outcome carrying a
   `routing-in-flight` refusal member. Exported, unit-tested red-first.
2. **The wiring** — a `FulfillmentRouterResolverPort`, one implementation in `libs/oms`,
   bound by each host, replacing the dependency-free module function at its two call sites.
3. **One integration test** proving `routed → fulfillment_works rows created`, driving
   dispatch/accept directly in-test.
4. Three follow-up issues for the exit-criterion gaps (§ 8.4).

### Out of scope (each with the reason)

- **R1–R6, R8–R14 of #2869.** Only R7 is in scope; R5/R6 are cut by § 5.2 of the spec, and the
  rest belong to #2869's own slice.
- **A `fulfillment.work.dispatch` producer.** Nothing in the tree enqueues that job type
  (verified: only the handler, the `JobTypeValues` entry and the registration exist). Which host
  enqueues it and under what idempotency key is a real design decision, and #2869's M8 explicitly
  claims to be that first producer. Adding it here would silently settle a question that issue
  exists to answer.
- **A rules-authoring HTTP surface** and **a dry-run (`evaluate()`) endpoint.** Both are genuine
  exit-criterion gaps; both are filed rather than built (§ 8.4).
- **Any migration.** Nothing here adds a column or a table. The `1871000000000` block was
  claimed defensively and is **not used**; it stays free for a sibling.

### Constraints

- The degenerate default must survive byte-identically: an install with no router configured
  behaves exactly as today. Four characterisation tests pin this (§ 9).
- `FulfillmentRouter` is deliberately absent from `CoreCapabilityValues` and from every manifest
  (#2393/#2403 — A2 is `config-only`). The resolution must **not** go through
  `getCapabilityAdapter`.
- `libs/core/src/fulfillment` is a registered zero-sibling-edge leaf
  (`barrel-purity.spec.ts`); nothing added there may import a sibling core context.
- `libs/core` must not depend on `@openlinker/oms` (dependency direction).
- **Naming**: `scripts/check-architecture-gates.mjs` caps exported `read*`/`parse*` helpers in a
  domain `*.types.ts` that touch `Connection.config` at **4, and it is at 4 of 4**. `check*` is
  outside that gate, which is one more reason the predicate is `checkManualRouteAdmissible`.
- **Imports in the two new core files**: own-context types **relatively**
  (`barrel-purity.spec.ts`'s allow-set for this leaf is empty), and never
  `@openlinker/core/orders` or `@openlinker/core/inventory`
  (`check-no-injection-contracts.mjs:138-140`).

---

## 3. Architecture Mapping

**Target layers**

| Layer | Change |
|---|---|
| CORE domain (`libs/core/src/fulfillment/domain/types/`) | `checkManualRouteAdmissible` (R7) |
| CORE domain (`libs/core/src/fulfillment/domain/ports/`) | `FulfillmentRouterResolverPort` |
| CORE tokens (`libs/core/src/fulfillment/fulfillment.tokens.ts`) | `FULFILLMENT_ROUTER_RESOLVER_TOKEN` |
| CORE application (`libs/core/src/orders/application/services/`) | the two call sites stop calling the module function and read the injected resolver |
| Product package (`libs/oms/src/routing/`) | `createOmsFulfillmentRouterResolver` — **the one body** |
| App (`apps/api`, `apps/worker`) | one `@Global()` binding module each |

**Capabilities involved**: `FulfillmentRouterPort` (existing, #2393), `ILocationService`,
`IInventoryQueryService`, `IFulfillmentWorkQueryService`, `RoutingRuleSourcePort`, `ConnectionPort`.

**Core vs Integration justification**: the *port* and the *token* belong in CORE because both
call sites are core services and the type they resolve (`FulfillmentRouterPort`) is already core.
The *implementation* belongs in `libs/oms` because it constructs `OlFulfillmentRouter`, which is
that package's own product logic; core may not import it.

---

## 4. Research

### 4.1 The two call sites

| Site | File | Today |
|---|---|---|
| Ingestion intercept | `libs/core/src/orders/application/services/order-ingestion.service.ts:819` | `null` ⇒ log + `{held:false, block:null}` (pass-through) |
| Route job handler | `apps/worker/src/sync/handlers/fulfillment-work-route.handler.ts:133` | `null` ⇒ `{outcome:'ok'}` |

Both first call `selectPrimaryFulfillmentRouter(...)` and only reach the resolver with a
`selection.holder` — a connection id that claims A2 (`config.sourcingAuthority`, read by
`parseAuthorityConfig`).

The module function's header is explicit that there must be **exactly one body**, because two
copies would let one site route while the other mirrors — a double shipment. That property is
preserved: after this change there is still exactly one place that answers *"is there a router for
this connection?"* — `createOmsFulfillmentRouterResolver` — and the hosts supply only wiring.

### 4.2 Why the module function cannot simply be filled in

`resolveFulfillmentRouter(connectionId)` is a bare module function with no dependencies.
`createOlFulfillmentRouter` requires five: `connectionId`, `rules` (`RoutingRuleSourcePort`),
`locations` (`ILocationService`), `inventory` (`IInventoryQueryService`), `works`
(`IFulfillmentWorkQueryService`). A module function cannot obtain them, and
`libs/core/src/orders` may not import `@openlinker/oms`. **The seam has to move.**

### 4.3 Where the binding can live (the Nest constraint that decides the design)

`OrderIngestionService` is declared in `OrdersModule`, so an injected token resolves from
`OrdersModule`'s injector — its own providers, its imports, and any `@Global()` provider. A
binding placed in the host's `AppModule` would **not** be visible to it.

`OrdersModule` already imports `FulfillmentModule` and `InventoryModule`; the worker's
`AppModule.forRoles` already carries both in its SHARED array; and `OmsModule.register()` is
already in both hosts' `plugins.ts`, re-exported by `PluginRegistryModule.forRoot`
(`exports: options.plugins`), so `ROUTING_RULE_SOURCE_TOKEN` is reachable.

`@Global()` has clear precedent in this repo — `RateLimitModule` (`libs/plugin-sdk`),
`CacheModule` and `RedisConfigModule` (`libs/shared`).

### 4.4 A trap the integration test must design around

`RoutingCommitService.refusalFor` refuses any plan carrying `unfulfillable` lines
(`plan-carries-unfulfillable`) or holds (`plan-carries-holds`). `OlFulfillmentRouter` never emits
holds (`holds: []`) but **does** emit `unfulfillable`. So a test order whose lines cannot be fully
sourced from an active location with stock is refused, not routed — and the refusal reads as a
`business_failure`, not as a wiring failure. This must be stated in the int-spec's header.

---

## 5. Questions & Assumptions

### Assumptions

- **A1.** A connection claiming A2 whose `platformType` is not `openlinker` gets `null` — OL's
  own router must not be built for somebody else's connection, whose `listActiveRules` would
  return nothing and whose every line would then read unfulfillable.
- **A2.** ~~`@Optional()` injection with a `null` default~~ — **withdrawn (tech-review, BLOCKING).**
  `@Optional()` makes a host that *forgot* the binding indistinguishable from one deliberately
  running router-less, and the null arm logs at `log` level, so the feature would silently do
  nothing while lint, type-check and every unit test passed. The injection is therefore
  **required**, and "no router" is an explicit value (`NullFulfillmentRouterResolver`) rather than
  an absent provider — so a host that forgets the binding **fails at boot**, the
  `assertFullLaneCoverage` posture.
- **A3.** The R7 predicate ships with no caller. This is argued in the file header rather than
  hidden (§ 6, Phase 1).

### Open questions (recorded, not blocking)

- **Q1.** Worker SHARED array or `jobs` role only? **SHARED**, but not for the reason first
  written. `OrdersModule` is **not** in the worker's SHARED array (verified: SHARED is
  `Database/Redis/Cache/IdentifierMapping/CoreIntegrations/Integrations/Products/Inventory/Sync/Fulfillment`);
  it is imported only by `SyncWorkerModule` (`sync-worker.module.ts:90`), and
  `FulfillmentWorkRouteHandler` is declared there too — so **both** worker call sites live under
  `jobs` and a `jobs`-only binding would produce no split answer. SHARED is chosen instead because
  a `@Global()` module must be in the graph to be global, it costs one factory call, and every
  context module it imports (`IntegrationsModule`, `InventoryModule`, `FulfillmentModule`,
  `IdentifierMappingModule`) is already in SHARED — so ADR-051's guarantee (a role that is off
  contributes no *context modules*) is untouched.
- **Q2.** Does #2942 need re-scoping given § 1's correction? The coordinator is amending it; the
  issue comments this plan produces must be consistent with that amendment.

---

## 6. Proposed Implementation Plan

### Phase 1 — R7 (the gate). Ships first, in its own commit.

1. **`checkManualRouteAdmissible`**
   - **File**: `libs/core/src/fulfillment/domain/types/manual-route-admissibility.types.ts`
   - **Action**: a pure function of one argument, no I/O, no injected dependency, no mutation —
     the `*.types.ts` pure-rule exception in `engineering-standards.md`, alongside the
     `applyPricingRule` / `resolveOfferLifecycle` precedents. Shape:

     ```ts
     export const ManualRouteRefusalReasonValues = ['routing-in-flight'] as const;
     export type ManualRouteRefusalReason = (typeof ManualRouteRefusalReasonValues)[number];

     export type ManualRouteAdmissibility =
       | { readonly status: 'admissible' }
       | { readonly status: 'refused'; readonly reason: ManualRouteRefusalReason;
           readonly decisionId: string };

     export function checkManualRouteAdmissible(
       live: RoutingDecision | null
     ): ManualRouteAdmissibility;
     ```

   - The outcome is a **closed union**, not a boolean, so #2869's producer must handle every arm
     and a second refusal reason is a compile error at the call site rather than a silent
     fall-through. `decisionId` rides on the refusal because R11 requires a refusal to be a
     sentence with a remedy, and the operator's remedy here is *"wait; the system is deciding"* —
     naming the decision is what makes that checkable in a log.
   - **The header must argue three things** (the coordinator's requirement):
     - it is **permanent** — no later slice replaces it;
     - it guards a **physical, unrecoverable** event — two parcels with two carriers, with no
       compensating write;
     - **the smell is named**: it ships with no caller, which is the ADR-048 decision-1
       "interface with no implementer" shape. Recorded, with the reason it is accepted here
       (spec § 5.2: *"a refusal is what a slice must never ship without"*), and with the
       entry-point obligation on #2869 stated in the file — **including that the obligation is
       enforced by an issue comment and a docblock, not by a compiler or a guard script**. A
       closed union only bites a caller that exists; nothing in the tree will fail if #2869's
       producer re-implements the check inline. Saying so is the honest version, and it is what
       tells the next reader the enforcement they are relying on is social.
   - It must also state **why it refuses where the router path resumes**:
     `RoutingCommitService.resumeOrRefuse` *resumes* a live decision belonging to the same router,
     because re-deriving the same `decisionId` yields the same idempotency key and the vendor
     dedups it. A manual route has no such key to re-derive, so resuming would mint a second plan.
     That asymmetry is the whole content of M3.
   - **Acceptance**: red-first — a unit spec written against the absent function, run, observed
     failing *for the right reason* (a missing export, not a compile error reporting
     `Tests: 0 total`), then made green.

2. **Barrel export**
   - **File**: `libs/core/src/fulfillment/index.ts`
   - **Action**: export the function, the type and the reason values.

3. **Unit spec**
   - **File**: `libs/core/src/fulfillment/domain/types/manual-route-admissibility.types.spec.ts`
   - **Cases**: `null` ⇒ admissible; a `live` decision ⇒ refused with `routing-in-flight` and
     that decision's id; the function mutates nothing and is a pure function of its argument
     (called twice with the same input ⇒ deep-equal output, and the argument is unchanged).

### Phase 2 — the resolver port and its one body

4. **`FulfillmentRouterResolverPort`**
   - **File**: `libs/core/src/fulfillment/domain/ports/fulfillment-router-resolver.port.ts`
   - **Action**: `resolve(connectionId: string): Promise<FulfillmentRouterPort | null>`.
     Imports only its own context's types, so the zero-sibling-edge leaf property holds.
   - The header carries the "exactly one body" argument forward verbatim from
     `fulfillment-router-resolution.ts`, because that is the property the move must not lose.

5. **Token**
   - **File**: `libs/core/src/fulfillment/fulfillment.tokens.ts`
   - **Action**: `export const FULFILLMENT_ROUTER_RESOLVER_TOKEN = Symbol('FulfillmentRouterResolverPort');`
     (the file's `Symbol`-only rule holds; the barrel already `export *`s it.)

6. **The one body**
   - **File**: `libs/oms/src/routing/oms-fulfillment-router.resolver.ts`
   - **Action**: `createOmsFulfillmentRouterResolver(deps): FulfillmentRouterResolverPort`, where
     `deps` are `{ connections, rules, locations, inventory, works, now? }`. It:
     1. reads the connection; if its `platformType !== OMS_PLATFORM_TYPE` ⇒ `null` (A1);
     2. otherwise returns `createOlFulfillmentRouter({ connectionId, rules, locations, inventory, works })`.
   - **The three `null` causes must be distinguishable in the log** (tech-review). Today the call
     sites emit one `log`-level line saying "no router is wired", which would cover a deliberately
     router-less install, a connection that claims A2 but is not an OMS connection, and a
     connection that could not be read. The first is routine (`log`); the second and third are
     misconfigurations an operator can fix and are emitted at `warn` **from the resolver**, naming
     the offending `platformType` in the second case. Degrading to today's path is the safe
     direction — an unrouted order is recoverable by hand, two shipments are not — but it must not
     be silent.
   - Note the second case is reachable: #2407 permits enabling A2 on *any* connection, so an
     operator who claims sourcing authority on a PrestaShop connection would otherwise get total
     silence.
   - **Acceptance**: unit spec covering both arms plus the unreadable-connection arm.
   - **Barrel**: exported from `libs/oms/src/index.ts`.

### Phase 3 — the call sites

7. **`OrderIngestionService`**
   - **File**: `libs/core/src/orders/application/services/order-ingestion.service.ts`
   - **Action**: append `@Inject(FULFILLMENT_ROUTER_RESOLVER_TOKEN) private readonly
     routerResolver: FulfillmentRouterResolverPort` to the constructor — **required, not
     `@Optional()`** (A2) — following the established append-with-a-comment shape every dependency
     since #2344 has used, and replace line 819 with
     `await this.routerResolver.resolve(selection.holder)`.
   - Also update the prose reference at `order-ingestion.service.ts:576`, which names
     `resolveFulfillmentRouter` and would otherwise be a dangling identifier.
   - Every surrounding branch — the `null` log, the pass-through return, the projection guard, the
     `routingCommit.route(...)` call — is **unchanged**.

8. **`FulfillmentWorkRouteHandler`**
   - **File**: `apps/worker/src/sync/handlers/fulfillment-work-route.handler.ts`
   - **Action**: the same optional injection and the same one-line replacement at line 133.
   - Update the file header: the "no router to call yet" section becomes "the router is resolved
     through `FulfillmentRouterResolverPort`; `null` remains the specified degenerate default".

9. **Retire the module function**
   - **File**: `libs/core/src/orders/application/services/fulfillment-router-resolution.ts`
   - **Action**: delete it and its barrel export (`libs/core/src/orders/index.ts:221`), so no
     second answer can survive. Its docblock's substance moves to the port.
   - **Note**: the four characterisation tests mock this module today
     (`order-ingestion.service.spec.ts:46-50`). They must be re-pointed at the injected resolver.
     Per the coordinator: **if any of those four needs its assertion changed, that is a finding,
     not a fix** — only the mocking mechanism may change, never what is asserted.

### Phase 4 — host binding

Three corrections from the gates apply to both files:

- **The module must `exports: [FULFILLMENT_ROUTER_RESOLVER_TOKEN]`.** `@Global()` makes a module's
  **exports** global, not its providers. Providing without exporting leaves the token invisible to
  `OrdersModule` — and with the injection now required, that is a boot failure rather than a silent
  no-op, which is exactly the safety the A2 change buys.
- **Import the host's `IntegrationsModule`, never the bare `PluginRegistryModule`.** The latter is
  `@Module({})` with a static `forRoot` (`plugin-registry.module.ts:24`); importing the class
  yields an empty module and `ROUTING_RULE_SOURCE_TOKEN` will not resolve, while re-calling
  `forRoot` would double-register every plugin. The api wrapper re-exports it
  (`apps/api/src/integrations/integrations.module.ts:103`), and the worker has its own wrapper.
- **Name the module that actually exports each token**: `LOCATION_SERVICE_TOKEN` and
  `INVENTORY_QUERY_SERVICE_TOKEN` from `InventoryModule` (api: the host wrapper
  `apps/api/src/inventory/inventory.module.ts`; worker: core's), `FULFILLMENT_WORK_QUERY_SERVICE_TOKEN`
  from `FulfillmentModule`, `CONNECTION_PORT_TOKEN` from `IdentifierMappingModule` (**not**
  `IConnectionService`, which is `apps/api`-only).

10. **API** — `apps/api/src/fulfillment/fulfillment-router-binding.module.ts`, imported from
    `AppModule`. (`apps/api/src/fulfillment/` already exists.)
11. **Worker** — `apps/worker/src/fulfillment/fulfillment-router-binding.module.ts`, added to
    `AppModule.forRoles`' SHARED array (Q1).

**Two thin host modules, one implementation.** A single shared binding module is not reachable —
each host has its own `IntegrationsModule` wrapper and `libs/` may not import from `apps/`. The
divergence axis this leaves is answered structurally rather than by convention: the *decision*
lives once in `createOmsFulfillmentRouterResolver`, and because the injection is required, a host
that omits its binding **fails to boot** instead of quietly running router-less.

### Phase 5 — the integration test

12. **`apps/api/test/integration/fulfillment-router-wiring.int-spec.ts`**
    - **The resolution half must be proved through the injector, not around it** (tech-review,
      IMPORTANT). A test that constructs its own router and calls `RoutingCommitService.route()`
      exercises the committer and proves nothing about the token being bound or reachable. So the
      spec **resolves `FULFILLMENT_ROUTER_RESOLVER_TOKEN` from `OrdersModule`'s own injector**
      (`app.select(OrdersModule).get(...)`, not the root injector — the root would pass even if
      `OrdersModule` could not see it) and asserts it returns a **non-null** router for the OMS
      connection and **`null`** for a non-OMS one.
    - **Proves**: an OMS connection with `config.sourcingAuthority` enabled and an active location
      with stock; an ingested order; `routingCommit.route(...)` returns `routed`; and
      `fulfillment_works` + `fulfillment_work_lines` rows exist for that order, with the decision
      `committed`.
    - **Plus a worker-side boot assertion** — `apps/worker/test/integration/fulfillment-router-binding-boot.int-spec.ts`,
      alongside the existing `fulfillment-no-injection-boot.int-spec.ts` and
      `oms-module-boot.int-spec.ts`. Both production call sites execute in the worker, so an
      api-only spec would leave the host that matters unproven.
    - **Then drives dispatch/accept directly in-test** through `FulfillmentHandshakeService` —
      never by enqueueing `fulfillment.work.dispatch`, which has no producer and must not gain one
      here — and asserts the work is then visible to the bench read
      (`BENCH_WORK_STATUSES` × `BENCH_WORK_REQUEST_STATUSES`).
    - **Header must record the § 4.4 trap**: the router emits `unfulfillable` lines when stock or
      an active location is missing, and the committer refuses such a plan
      (`plan-carries-unfulfillable`) — so a fixture that under-stocks reads as a routing refusal,
      not as broken wiring. This is written for the next person who writes a routing test.
    - Follows the existing harness (`./setup`, `loginAsAdmin`, `resetTestHarness`) and the
      `routing-commit.int-spec.ts` / `bench-work.int-spec.ts` shapes.

### Phase 6 — issues and documentation

13. Comment on **#2869** and **#2408** (§ 8.4), file the three gap issues, and update
    `docs/architecture-overview.md` § 26 Fulfillment with the resolver seam.

---

## 7. Alternatives Considered

### Alternative 1 — fill in the module function via a boot-time registry (a module-level setter)

A `registerFulfillmentRouterResolver(fn)` called at host boot, keeping
`resolveFulfillmentRouter` a module function.

**Rejected**: it is global mutable state with no DI visibility — untestable in isolation,
order-dependent at boot, and invisible to the module graph. Its only merit is that it touches
neither call site, and the call-site change here is one line each.

### Alternative 2 — `FulfillmentModule` provides a default null resolver

**Rejected on Nest semantics.** A provider bound in `FulfillmentModule` would **shadow** the
host's `@Global()` binding for `OrderIngestionService` (nearest injector wins), so the OMS
resolver would never be seen — the wiring would type-check, pass unit tests, and silently do
nothing. `@Optional()` with a `null` default gives the identical degenerate behaviour without
that trap.

### Alternative 3 — bind the resolver inside `OmsModule`

**Rejected**: `OmsModule` deliberately imports no sibling context module, and the resolver needs
three. Importing them there would drag `InventoryModule`/`FulfillmentModule` providers into the
worker's `events`, `scheduler` and `maintenance` roles, which is exactly the ADR-051 guarantee
that module's docblock protects.

### Alternative 4 — resolve via `getCapabilityAdapter(connectionId, 'FulfillmentRouter')`

**Rejected, and forbidden**: the name is absent from `CoreCapabilityValues` and from every
manifest by design (#2393/#2403), a live spec asserts that absence, and adding it would
reintroduce the #2085 stamped-at-create trap.

---

## 8. Validation & Risks

### 8.1 Architecture compliance

- ✅ Port in the domain layer, implementation outside core, injection by Symbol token.
- ✅ `libs/core/src/fulfillment` gains no sibling-context import — `barrel-purity.spec.ts` holds.
- ✅ `libs/core` gains no dependency on `@openlinker/oms`; the edge points the other way.
- ✅ No `getCapabilityAdapter` path for a `config-only` authority.
- ✅ `fulfillment.tokens.ts` keeps its `Symbol`-only rule.

### 8.2 Risks

| Risk | Mitigation |
|---|---|
| A `@Global()` provider is shadowed by a nearer binding | Nothing else binds the token; asserted by an int-spec that resolves it from `OrdersModule`'s injector. |
| Turning routing on changes ingestion behaviour for existing installs | It cannot: the resolver returns `null` unless a connection is `platformType: 'openlinker'` **and** claims A2 — and #2407 already refuses enabling A2 with zero active locations. |
| The four characterisation tests are "fixed" rather than re-pointed | Explicitly called out in step 9; any assertion change is a finding. |
| A routing refusal is mistaken for broken wiring | § 4.4 recorded in the int-spec header. |

### 8.3 Backward compatibility

✅ An install with no OMS connection, or one that has not enabled A2, is byte-identical to today.
The only behavioural delta requires an operator to (a) create an OMS connection, (b) enable
`sourcingAuthority` on it — which #2407 already gates on having an active location — and
(c) author routing rules, for which there is still no HTTP surface (§ 8.4).

### 8.4 The exit criterion is only partly reachable — three gaps, filed not built

Wave 3a's exit criterion is *"an operator with two locations enables the OL-OMS connection,
authors an ordered filter/sort list, sees a dry-run explanation for an incoming order, and works
the resulting tasks to shipped."* Wiring the router delivers the middle of that and stops.

| Gap | Evidence | Blocks |
|---|---|---|
| No rules-authoring HTTP surface | `OmsRoutingRuleRepository` + its migration exist; no controller. `ROUTING_RULE_SOURCE_TOKEN` has no production consumer. | *"authors an ordered filter/sort list"* |
| No dry-run endpoint | `OlFulfillmentRouter.evaluate()` has no caller and no route. | *"sees a dry-run explanation"* |
| No `fulfillment.work.dispatch` producer | Only the handler, the `JobTypeValues` entry and the registration exist. The bench filters on `accepted`, so work is created and never reaches a bench. | *"works the resulting tasks to shipped"* |

---

## 9. Testing Strategy & Acceptance Criteria

### Unit tests

- `libs/core/src/fulfillment/domain/types/manual-route-admissibility.types.spec.ts` — R7,
  **written red first**.
- `libs/oms/src/routing/oms-fulfillment-router.resolver.spec.ts` — OMS connection ⇒ a router;
  non-OMS connection ⇒ `null`; unreadable connection ⇒ `null` + warn.
- `libs/core/src/orders/application/services/__tests__/order-ingestion.service.spec.ts` — the four
  degenerate-default cases (from line 2018 and line 2296) **re-pointed at the injected resolver,
  assertions unchanged**, including the whole-object `toEqual` on the `syncOrder` request.
- `apps/worker/src/sync/handlers/__tests__/` — the route handler's `null` arm still returns
  `{outcome: 'ok'}`; a non-null resolver reaches `routingCommit.route`.

### Integration test

- `apps/api/test/integration/fulfillment-router-wiring.int-spec.ts` (§ 6 step 12).

### Acceptance criteria

- [ ] `checkManualRouteAdmissible` exists, is pure, is barrel-exported, and its spec was observed
      failing before it was made to pass.
- [ ] Its header argues permanence, the physical-hazard rationale, and names the no-caller smell.
- [ ] `resolveFulfillmentRouter` (the module function) no longer exists, and exactly one body
      answers *"is there a router for this connection?"*.
- [ ] The binding module **exports** the token, and an int-spec resolves it **from `OrdersModule`'s
      injector** (`app.select(OrdersModule)`), never the root injector.
- [ ] The injection is **required** — a host that omits the binding fails at boot, proved by a
      worker-side boot spec as well as the api one.
- [ ] The three `null` causes are distinguishable in the log; a non-OMS A2 claimant warns.
- [ ] With no OMS connection, ingestion is byte-identical — the four characterisation tests pass
      unchanged in what they assert.
- [ ] With an OMS connection claiming A2, an active stocked location and a ruleset, an ingested
      order produces `fulfillment_works` rows and a `committed` routing decision.
- [ ] No `fulfillment.work.dispatch` producer is added.
- [ ] No migration is added; the `1871000000000` block is left free.
- [ ] `pnpm lint`, `pnpm type-check`, `pnpm test` green; the new int-spec green.
- [ ] Three gap issues filed; #2869 and #2408 commented with the corrected gate trigger.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (port in domain, implementation outside core)
- [x] Respects CORE vs Integration boundaries
- [x] Uses existing patterns (`@Global()` precedent, optional-injection precedent, pure-rule
      `*.types.ts` exception, `Symbol` tokens)
- [x] Idempotency considered — unchanged; the decision row and its derived key still own it
- [x] Error handling — an unreadable connection degrades to the safe direction, loudly
- [x] Testing strategy complete
- [x] Naming conventions followed (`*.port.ts`, `*.types.ts`, `*.resolver.ts`, `*_TOKEN`)
- [x] Plan is execution-ready

---

## Related Documentation

- [ADR-054 — fulfilment work as the unit of assignment](../architecture/adrs/054-fulfillment-work-unit-of-assignment.md)
- [ADR-053 — the fulfilment-authority vocabulary leaf](../architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md)
- [ADR-055 — the OMS as a credential-less connection plugin](../architecture/adrs/055-oms-as-credentialless-connection-plugin.md)
- [ADR-051 — worker topology, one artifact, roles](../architecture/adrs/051-worker-topology-one-artifact-roles.md)
- [Manual bench routing spec](../specs/product-spec-manual-bench-routing.md) — § 5.1 (the gate), § 5.2 (the cut), M3
