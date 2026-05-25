# Implementation Plan: Fulfillment-routing model + compatibility (#832)

**Date**: 2026-05-25
**Status**: Implemented — reconciled to the final shape after a `/grill-me` design review (Q1–Q8). See §0.
**Estimated Effort**: ~2–4 days for the scoped foundation below (issue is labelled **L**; the L estimate includes the downstream adapters/FE/read-back which are *separate* issues #833–#839)

---

## 0. Design Reconciliation (Q1–Q8 — supersedes shape details below)

The original draft (§1–§9) was sharpened through an interview that walked every
branch of the design tree. The **final, implemented shape** differs from the
draft in four ways — where the prose below still describes the draft shape, this
section wins.

**Final rule shape** — `(sourceConnectionId, sourceDeliveryMethodId) → { processorKind, processorConnectionId }`. The draft's `ompDestinationConnectionId` and `destinationCarrierId` columns were **dropped** (Q3/Q8): the OMP destination is *derived* (orders fan out to **all** `OrderProcessorManager` connections — `OrderSyncService.resolveDestinations` — so there is no single stored destination), and the branch-1 carrier stays **co-keyed** in `connection_carrier_mappings`.

**Final service surface** — `IFulfillmentRoutingService` exposes `getRules` / `replaceRules` / `resolve(query)`. There is **no** `resolveForOrder` and **no** live wiring into the PrestaShop order-processor adapter (Q2 = option **C**): #832 ships the **model + resolution + compatibility validation only**. The dispatch orchestrator that calls `resolve()` on the live order path is **#835**; branch-2/3 execution is **#833**. Consequently there is no `UnsupportedProcessorKindException` — nothing executes a non-default kind yet.

**Final compatibility** — capability **+ topology** (Q5): `omp_fulfilled` → processor declares `OrderProcessorManager`; `ol_managed_carrier` → declares `ShippingProviderManager` **and** processor ≠ source; `source_brokered` → declares `ShippingProviderManager` **and** processor == source. Method-granular eligibility (the OQ-B1 `/delivery-services` namespace probe) is a **#833** refinement layered behind the same `assertCompatible` seam — not a #832 dependency. See ADR-012 § "Rule shape & compatibility".

**AC amendments to record at close** (so #832 can be checked off honestly):
- **AC-1** ("selecting a processor + OMP destination + destination carrier") — satisfied *in intent*: processor is stored; OMP destination is **derived** (fan-out) and destination carrier is **co-keyed** in `CarrierMapping`, neither stored on the rule. US-1's "and a destination" is met because the destination is the fan-out target set, not a per-rule column.
- **AC-2** ("compatible for a given method") — satisfied at **capability + topology** granularity; method-granular eligibility deferred to #833 behind the seam. Honest to check given the spec marks method↔modality a Phase-C / #833 question.
- **AC-3** ("the system resolves the configured processor") — `resolve()` is implemented and unit/integration-tested; it is **not yet wired** into the live order path (Q2 = C). The resolver-call-site is #835. Record this explicitly in the PR body. **#835 must handle the resolution asymmetry**: a *configured* `omp_fulfilled` rule resolves with a non-null `processorConnectionId`, but the *default* `omp_fulfilled` (no rule) resolves with `processorConnectionId: null` (no single fulfilling OMP under fan-out) — the dispatcher must treat null as "fan-out default," not "no processor."
- **AC-4** ("preserved/upgraded") — **preserved, additive** (not destructively upgraded): `connection_carrier_mappings` is untouched and remains the co-keyed branch-1 carrier source.

---

## 1. Task Summary

**Objective**: Introduce a general, source-/carrier-/OMP-agnostic **fulfillment-routing model** — a connection-scoped mapping of `(orderSource, sourceDeliveryMethod) → fulfillment processor` (final shape, §0) — generalizing today's `CarrierMapping` (which hardcodes the *OMP-fulfilled* `allegroDeliveryMethodId → prestashopCarrierId` branch for the Allegro→PS pair). Plus a resolution service (`resolve(query)` → processor, with today's PS-fulfilled `omp_fulfilled` fallback), capability + topology compatibility validation, a migration, and the **branch-1 modeling ADR**.

**Context**: Foundation (E1) for the #732 Allegro Delivery epic — see `docs/specs/product-spec-732-allegro-delivery-shipment.md` §1, §"Is this three capabilities, or one?", §5 AC-1, §9. Blocks #833 (Allegro Delivery adapter), #834 (branch-1 read-back), #835 (#727 InPost convergence), #836/#839 (FE).

**Classification**: **CORE** (`mappings` context, generalizing `CarrierMapping`) + a thin, behaviour-preserving wiring touch in the PrestaShop integration. **+ ADR.**

---

## 2. Scope & Non-Goals

### In Scope
- `FulfillmentRoutingRule` domain entity + types + repository port/impl + ORM entity in the `mappings` context.
- `fulfillment_routing_rules` table + migration (up/down round-trip).
- `FulfillmentRoutingService` (application service) — `resolve(query)` → routing decision with **today's PS-fulfilled `omp_fulfilled` default** when unconfigured; `getRules` / `replaceRules` + **capability + topology compatibility validation** on persist.
- **ADR-012**: branch-1 (OMP-fulfilled) modeling decision.
- Unit + integration tests.

### Out of Scope (separate issues)
- **Live order-path wiring of the resolver** — the dispatch orchestrator that calls `resolve()` is **#835** (Q2 = C). #832 is model + resolution + compatibility only.
- Allegro Delivery adapter / `/shipment-management/*` (#833).
- Branch-1 (PS-fulfilled) status read-back + the `FulfillmentStatusReader` capability *implementation* (#834) — ADR-012 *names* it; #834 builds it.
- **Method-granular compatibility** (mapping a `sourceDeliveryMethodId` → adapter `ShippingMethod`/modality via the seller's `/delivery-services` set; the OQ-B1 namespace probe). #832 ships **capability-level** compatibility behind a seam; #833 sharpens it.
- #727 InPost convergence (#835); all FE (#836, #839).
- Destructive fold/removal of `connection_carrier_mappings` (see §7 Alt-2).

### Constraints
- **No regression** to today's Allegro→PS carrier resolution (`resolveExternalCarrierId`).
- Migration must round-trip; existing `CarrierMapping` data preserved.
- Anemic-by-default entities per **ADR-011**.
- No new ESLint warnings / type errors.

---

## 3. Architecture Mapping

**Target Layer**: CORE — `libs/core/src/mappings/**` (the context that owns `CarrierMapping`); behaviour-preserving wiring in `libs/integrations/prestashop/**`.

**Capabilities Involved**:
- `ShippingProviderManagerPort` (#763) — consulted by compatibility validation for branches 2/3; **not implemented here**.
- `OrderProcessorManagerPort` — the branch-1 (omp_fulfilled) executor that already ships.
- `IIntegrationsService` — to resolve a processor connection's declared capabilities for compatibility checks.

**Existing Services Reused**:
- `MappingConfigService.resolveCarrierMapping` (the branch-1 carrier detail) + `resolveExternalCarrierId` chain (`prestashop-order-processor-manager.adapter.ts:650`).
- `IIntegrationsService` capability resolution; `IdentifierMappingService` formatting (`formatInternalId`) if a prefixed id is wanted (rules can use `uuid` PK like `CarrierMapping` — simplest, mirrors the existing mapping table).

**New Components**:
- Domain: `FulfillmentRoutingRule` entity, `fulfillment-routing.types.ts`, `FulfillmentRoutingRepositoryPort`, routing exceptions.
- Application: `FulfillmentRoutingService` + `IFulfillmentRoutingService`.
- Infrastructure: `FulfillmentRoutingRepository` + `FulfillmentRoutingRuleOrmEntity`.
- Tokens: `FULFILLMENT_ROUTING_REPOSITORY_TOKEN`, `FULFILLMENT_ROUTING_SERVICE_TOKEN` (in `mappings.tokens.ts`).
- Migration: `apps/api/src/migrations/{ts}-add-fulfillment-routing-rules.ts`.
- ADR-012 + index row.

**Core vs Integration Justification**: routing is domain policy (which processor fulfils an order) — must be CORE so every order source/OMP/carrier reasons against one model. It generalizes `CarrierMapping`, already in `mappings`. The PrestaShop touch is only the *consumption* seam (an integration consuming a CORE port), preserving the boundary.

---

## 4. External / Domain Research

### Internal patterns (verified — see codebase audit)
- **`CarrierMapping`** (`libs/core/src/mappings/...`): 4-field anemic entity; ORM table `connection_carrier_mappings` (unique `connection_id` + `allegro_delivery_method_id`, FK → `connections` ON DELETE CASCADE); repo `findByConnectionId` / `replaceForConnection` (delete+insert in a transaction); facade `MappingConfigService.resolveCarrierMapping(sourceConnectionId, methodId)`.
- **Branch-1 resolution today** (`prestashop-order-processor-manager.adapter.ts:650-705`): `resolveExternalCarrierId` chains CarrierMapping → `config.defaultCarrierId` → OL Dynamic carrier. This *is* the omp_fulfilled default the new model must reproduce.
- **`ShippingProviderManagerPort`** (`libs/core/src/shipping/...`): `generateLabel` + `getTracking({providerShipmentId})` + `getSupportedMethods(): readonly ShippingMethod[]`; `ShipmentCanceller` / `PickupPointFinder` sub-capabilities with `is*` guards. No adapter implements it on `main` yet.
- **Migration/module/tokens conventions**: mirror `AddConnectionMappingTables1778000000000`; `mappings.tokens.ts` Symbol tokens; ORM discovered via the `libs/core/src/**/*.orm-entity{.ts,.js}` glob in `apps/api/src/database/data-source.ts` (no `orm-entities.ts` sub-barrel needed unless an external consumer needs the entity — none does).

### Key spec facts shaping the model
- Three **processor kinds** are a *taxonomy of where the fulfilling connection sits*, not three mechanisms (spec §"Is this three capabilities, or one?"). Branches 2 & 3 = same `ShippingProviderManagerPort`, different adapters. **Branch 1 is the genuine fork** (no `generateLabel`, no `providerShipmentId`).
- Routing key = **source delivery method** (`OrderShipping.methodId`); modality is adapter-internal; destination carrier matters only for branch 1.
- Compatibility is **adapter-declared**, never hardcoded (R1: keep it behind an abstraction so its source can change).

---

## 5. Questions & Assumptions

### Decisions to confirm (see §7 for rationale)
1. **Branch-1 modeling (ADR-012)** — recommend **Option (ii): delegate-to-OMP** (branch 1 stays on `OrderProcessorManagerPort` + `CarrierMapping`; only branches 2/3 are `ShippingProviderManagerPort`; read-back is a separate `FulfillmentStatusReader` capability, *implemented in #834*). Rejected: Option (i) degenerate PS adapter (no-op `generateLabel`, providerShipmentId-less `getTracking`) — a degenerate abstraction that pollutes the port for every consumer, against the ADR-011 instinct and the spec's own observation that branch 1 "doesn't fit `getTracking({providerShipmentId})` cleanly."
2. **Migration strategy** — recommend **additive**: new `fulfillment_routing_rules` table; `connection_carrier_mappings` kept intact as the branch-1 carrier detail + resolution fallback. Satisfies "preserved/upgraded" via preservation + logical generalization, with a trivial down-migration and zero regression. Rejected: destructive fold (migrate rows + drop `connection_carrier_mappings`) — OMP-destination is ambiguous at migration time (a CarrierMapping row doesn't record which PS connection is the OMP), and it couples to #835/#836.
3. **Compatibility granularity** — recommend **capability-level** for #832 (a processor connection is compatible iff it declares the capability its `processorKind` requires: branches 2/3 → `ShippingProviderManager`; branch 1 → `OrderProcessorManager` and processor == OMP). **Method-granular** compatibility (method→modality via `/delivery-services`, OQ-B1) deferred to #833, behind the same `FulfillmentRoutingService` seam.
4. **Live wiring** — recommend threading `resolveForOrder` into the PS order processor so the **default path reproduces today's behaviour** (proves AC + no-regression in an int-test); branches 2/3 resolve but throw an explicit `UnsupportedProcessorKindException` until #833 (operators can't create such rules until the FE/adapter exists; the migration creates none).

### Assumptions
- Rule PK is `uuid` (mirrors `CarrierMapping`), not an `ol_*` prefixed id — rules are config rows, not cross-context entities.
- `sourceConnectionId` is the order **source** connection (Allegro), matching today's CarrierMapping scoping convention.
- One rule per `(sourceConnectionId, sourceDeliveryMethodId)` (unique constraint).

### Documentation gaps
- The method↔modality compatibility key is explicitly a Phase C / #833 question (spec §3.3) — recorded here as deferred, not invented.

---

## 6. Proposed Implementation Plan

### Phase 0 — ADR (decision first)
1. **ADR-012 — branch-1 fulfillment modeling**
   - **File**: `docs/architecture/adrs/012-branch-1-fulfillment-modeling.md` (+ index row in `README.md`; pointer in `architecture-overview.md` § appropriate shipping/mappings section).
   - **Action**: Record Option (ii) (delegate-to-OMP + future `FulfillmentStatusReader`), alternatives (i)/(ii), consequences. Reference spec §"Is this three capabilities, or one?" and ADR-011.
   - **Acceptance**: `check:invariants` (repo-url + ADR conventions) green; ≤500-word body; index updated.

### Phase 1 — Domain + persistence (the model)
2. **Types** — `libs/core/src/mappings/domain/types/fulfillment-routing.types.ts`
   - `FulfillmentProcessorKindValues` as-const union (`omp_fulfilled | ol_managed_carrier | source_brokered`); `FulfillmentRoutingRuleInput`; `FulfillmentRoutingResolution` (+ `source: 'rule' | 'default'`).
   - **Acceptance**: types-only file; no runtime artifact beyond the values array.
3. **Entity** — `domain/entities/fulfillment-routing-rule.entity.ts` (anemic; readonly fields per ADR-011).
4. **Repository port** — `domain/ports/fulfillment-routing-repository.port.ts`: `findBySourceConnectionId`, `findRule(sourceConnectionId, methodId)`, `replaceForConnection(sourceConnectionId, items)`.
5. **Exceptions** — `domain/exceptions/`: `IncompatibleProcessorException` + `DuplicateRoutingRuleException` (both extend `Error`, per standards). *(No `UnsupportedProcessorKindException` — §0: nothing executes a non-default kind in #832, so there is no execution-guard to throw.)*
6. **ORM entity** — `infrastructure/persistence/entities/fulfillment-routing-rule.orm-entity.ts`: table `fulfillment_routing_rules`; unique `(source_connection_id, source_delivery_method_id)`; FKs `source_connection_id` **and** `processor_connection_id` → `connections` ON DELETE CASCADE; columns `processor_kind`, `processor_connection_id`, timestamps. *(Final shape, §0: no `omp_destination_connection_id` / `destination_carrier_id` columns — derived/co-keyed.)*
7. **Repository impl** — `infrastructure/persistence/repositories/fulfillment-routing.repository.ts` (mirror `CarrierMappingRepository`: `replaceForConnection` = delete+insert in a `dataSource.transaction`; private `toDomain`).
8. **Tokens** — append to `mappings.tokens.ts`; **barrel** `index.ts` exports entity, types, port type, exceptions (per cross-context contract rules — repo *port* is intra-context, but the resolution *service interface* is the cross-context seam).
   - **Acceptance**: `mappings` barrel-purity holds; tokens auto-exported via `export * from './mappings.tokens'`.

### Phase 2 — Migration
9. **Migration** — `apps/api/src/migrations/{ts}-add-fulfillment-routing-rules.ts` (unique 13-digit ts; class suffix matches). `up`: `CREATE TABLE fulfillment_routing_rules`. `down`: `DROP TABLE`. Leaves `connection_carrier_mappings` untouched.
   - **Acceptance**: `pnpm --filter @openlinker/api migration:show` lists it; `migration:run` then `migration:revert` round-trips; `check-migration-timestamps` green.

### Phase 3 — Resolution + compatibility service *(final surface — §0)*
10. **Service interface** — `application/interfaces/fulfillment-routing.service.interface.ts` (`IFulfillmentRoutingService`): `getRules(sourceConnectionId)`, `replaceRules(sourceConnectionId, items)`, `resolve(query)`. *(No `resolveForOrder` — the live order-path call site is #835.)*
11. **Service impl** — `application/services/fulfillment-routing.service.ts`:
    - `resolve(query)`: `findRule(sourceConnectionId, sourceDeliveryMethodId)` → `{ processorKind, processorConnectionId, source: 'rule' }`; null method or no rule → **default** `{ processorKind: omp_fulfilled, processorConnectionId: null, source: 'default' }` (no single fulfilling OMP under fan-out).
    - `replaceRules`: validate the whole batch before persisting — reject duplicate `(method)` rows (`DuplicateRoutingRuleException`), assert the source connection resolves (`getAdapter`), then validate every rule's **capability + topology** compatibility (§0) via `IIntegrationsService.getAdapter`, rejecting with `IncompatibleProcessorException`. Validation isolated in private `assertNoDuplicateMethods` + `assertCompatible(sourceConnectionId, item)` (the latter carries an exhaustiveness `default` so a new processor kind can't bypass the gate) — the #833 method-granular extension point. Validating at the service keeps the unique constraint + connection FKs from surfacing as raw `QueryFailedError`.
    - Bind in `mappings.module.ts` (providers + token + export); inject `INTEGRATIONS_SERVICE_TOKEN` + the repository token.
    - **Acceptance**: unit tests cover rule-hit, default fallback (null + unmapped method), and each kind's compatibility accept/reject.
12. **Live wiring — DEFERRED to #835** (Q2 = C). #832 stops at the resolver; nothing calls `resolve()` on the order path yet, so today's behaviour is preserved by *omission* (the existing `resolveExternalCarrierId` chain is untouched). The integration test exercises `resolve()` and compatibility directly through the service rather than through the order path.

### Phase 4 — Tests
13. **Unit**: `fulfillment-routing.service.spec.ts` — mocks the repository port + `IIntegrationsService`; covers resolution (rule-hit / default / null-method) and capability + topology compatibility accept/reject for all three kinds. *(No separate repository unit spec — the repo is a thin delete+insert mirror of `CarrierMappingRepository`, exercised by the int-spec against real Postgres.)*
14. **Integration**: `test/integration/fulfillment-routing.int-spec.ts` (Testcontainers) — persist + read-back round-trip, full-replace semantics, `resolve` rule-hit + `omp_fulfilled` default, compatibility validated against the **real** booted adapter manifests (PrestaShop / Allegro / InPost), and the migration's `ON DELETE CASCADE` FK (deleting a processor connection drops its rules).

---

## 7. Alternatives Considered

- **Branch-1 = degenerate `ShippingProviderManagerPort` adapter (Option i)** — rejected: forces a no-op `generateLabel` + a `providerShipmentId`-less `getTracking`, polluting the port contract for every consumer; contradicts ADR-011's "no degenerate abstractions" and the spec's own note. Option (ii) keeps the port honest.
- **Destructive CarrierMapping fold** — rejected for #832: OMP-destination is ambiguous per existing row, down-migration is lossy, and it couples to #835/#836. Additive layering gives zero-regression now; a later consolidation can happen once the FE (#836) writes routing rules directly.
- **Put the model in `shipping` not `mappings`** — rejected: it *generalizes `CarrierMapping`* (in `mappings`), and orders already imports `MappingsModule`; placing it in `shipping` would add a new cross-context edge for no benefit.
- **A standalone `MethodCompatibilityPort` now** — deferred: capability-level compatibility is a small service-internal check for #832; extracting a port earns its place in #833 when the `/delivery-services` granularity lands.

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ CORE owns the model; integration only consumes it via the service interface. Anemic entity (ADR-011). Symbol tokens + barrel conventions (#595). Migration conventions (#599/#374).

### Risks
- **R1 — compatibility-key namespace (OQ-B1)**: method-granular compat is unproven (sandbox probe pending). *Mitigation*: #832 ships only capability-level compat behind `assertCompatible`; the granular logic + probe are #833.
- **R2 — accidental regression in order processing**: *Mitigation*: default resolution reproduces today's path verbatim; existing PS int-spec must stay green + a new no-regression int-spec.
- **R3 — scope creep into adapters/read-back**: *Mitigation*: explicit Out-of-Scope; branches 2/3 guarded with `UnsupportedProcessorKindException`.

### Backward Compatibility
- ✅ Additive table; `connection_carrier_mappings` untouched; live path behaviour-identical when no rule exists. Down-migration drops only the new table.

---

## 9. Testing Strategy & Acceptance Criteria

### Unit
- `fulfillment-routing.service.spec.ts`, `fulfillment-routing.repository.spec.ts` (mock ports / ORM repo).

### Integration
- `fulfillment-routing.int-spec.ts` (Testcontainers): persist/replace round-trip, `resolve` rule-hit + `omp_fulfilled` default, compatibility against real adapter manifests, FK `ON DELETE CASCADE`.

### Acceptance Criteria (mirrors #832 — amendments per §0)
- [x] A routing rule persists per `(source, delivery method)` selecting a **processor**. OMP destination is *derived* (fan-out) and destination carrier is *co-keyed* in `CarrierMapping` — see §0 / AC-1 amendment.
- [x] Only **capability + topology-compatible** processors are valid (incompatible rejected). Method-granular eligibility deferred to #833 behind `assertCompatible` — see §0 / AC-2 amendment.
- [x] `resolve()` returns the configured processor; unconfigured → today's `omp_fulfilled` default. **Resolver not yet wired to the live order path** (#835) — see §0 / AC-3 amendment.
- [x] Migration up/down round-trips; `CarrierMapping` data **preserved** (additive, not destructively upgraded) — see §0 / AC-4 amendment.
- [x] ADR-012 filed for branch-1 modeling (incl. rule-shape + compatibility note).
- [x] Tests added (unit + integration); no new ESLint/type errors.

---

## 10. Alignment Checklist
- [x] Hexagonal architecture; CORE/Integration boundary respected
- [x] Existing patterns reused (CarrierMapping shape, mappings module, migration conventions); no unnecessary abstractions
- [x] Idempotency: `replaceForConnection` transactional delete+insert
- [x] Error handling: domain exceptions in `domain/exceptions/`
- [x] Testing strategy complete (unit + integration)
- [x] Naming + file structure per standards; ADR-011 anemic entities
- [x] Plan saved as markdown

## Related Documentation
- `docs/specs/product-spec-732-allegro-delivery-shipment.md` · `docs/architecture/adrs/011-domain-entity-behavior.md` · `docs/migrations.md` · `docs/engineering-standards.md`
