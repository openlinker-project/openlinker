# Implementation Plan: Erli Offers Vertical-Slice Integration Tests (#991)

**Date**: 2026-06-16
**Status**: Draft / Ready for Review
**Estimated Effort**: M (3–5 days)
**Issue**: #991 — closes the offers half of the Erli integration (parent spec #978, ADR-025)

---

## 1. Task Summary

**Objective**: Add a deterministic integration-test suite (`*.int-spec.ts`) that exercises the Erli **offers vertical slice** end-to-end against a **faked Erli API**, covering: create offer → sparse field update → quantity/price propagation; multi-variant grouping → one grouped listing; frozen-field write suppression + 0-stock listing as 0; offer-status reconciliation reflecting real Erli state after async (HTTP 202 / ~20-min cache lag) settle.

**Context**: The Erli offers half (#984 offer manager, #985 category/param, #986+#1065 variant grouping, #988 frozen-field + stock/price, #1066 frozen-stock quantity path, #989 offer-status reconciliation) is implemented and unit-tested per-issue. #991 is the **integration backstop** that proves these pieces compose correctly through the real `ErliOfferManagerAdapter` + core wiring + DB persistence (`offer_status_snapshots`). It is the last offers-half issue; merging it declares the offers half complete.

**Classification**: Testing/QA (Integration). **No production code change** beyond test infrastructure; no migration.

---

## 2. Scope & Non-Goals

### In Scope
- One vertical-slice int-spec exercising the offers flow against a faked Erli API.
- A reusable test helper that registers a **real `ErliOfferManagerAdapter` wired to a fake `IErliHttpClient`** through the production adapter-resolution seam (`AdapterRegistryService` + `AdapterFactoryResolverService`), mirroring `allegro-test-offer-manager-stub.helper.ts`.
- Coverage of: create (POST 202 → `'draft'`), sparse PATCH, quantity propagation, variant grouping body shape, frozen-field suppression, 0-stock, and offer-status reconciliation into `offer_status_snapshots`.

### Out of Scope
- The orders half (#993–#998) and the sandbox spike (#992). Field names remain #992-provisional; this spec asserts adapter **behaviour against the documented contract**, not live Erli responses.
- Real HTTP / Testcontainers for Erli itself (there is no Erli container; the API is faked in-process).
- Re-testing unit-level branches already covered by `erli-offer-manager.adapter.spec.ts` / `offer-status-sync.service.spec.ts`. The int-spec proves **composition + persistence**, not every branch.
- Scheduler/cron timing — schedulers stay disabled (per `setup.ts`); reconciliation is driven by **direct service invocation**.

### Constraints
- Must run under `pnpm test:integration`, `maxWorkers: 1`, deterministic, no wall-clock/real-timer dependence.
- No new ESLint/type errors. Resource-constrained CI: keep the suite tight (one spec file, suite-scoped harness).

---

## 3. Architecture Mapping

**Target Layer**: Testing — `apps/api/test/integration/` (shared plugin int-spec location; the Erli package has no `*.int-spec.ts` infra and its `jest.config.mjs` matches unit specs only).

**Capabilities Involved**: `OfferManagerPort` + `OfferCreator` + `OfferFieldUpdater` + `OfferStatusReader` (all implemented by `ErliOfferManagerAdapter`).

**Existing Services / Seams Reused**:
- `@openlinker/test-kit` `createIntegrationTestHarness` via `apps/api/test/integration/setup.ts` (`getTestHarness`/`resetTestHarness`/`teardownTestHarness`).
- Adapter-resolution seam: `AdapterRegistryService` (`ADAPTER_REGISTRY_TOKEN`) + `AdapterFactoryResolverService` (`ADAPTER_FACTORY_RESOLVER_TOKEN`) — the exact pattern in `apps/api/test/integration/helpers/allegro-test-offer-manager-stub.helper.ts`.
- `IErliHttpClient` (`libs/integrations/erli/src/infrastructure/http/erli-http-client.interface.ts`) — the fake implements this 3-method (`get`/`post`/`patch`) interface; the **real** `ErliOfferManagerAdapter` is constructed against it, so adapter mapping logic is exercised.
- `CACHE_PORT_TOKEN` / `CachePort` (`@openlinker/shared` cache; `@Global` Redis-backed) — resolved from the harness app and passed as the adapter's 4th ctor arg, so the **frozen-stock cache** (`erli:frozen-stock:{connectionId}:…`) is live (required for S3's no-op branch).
- Core `OfferStatusSyncService.sync(connectionId, options)` + `offer_status_snapshots` table for the reconciliation scenario. **New ground**: no existing int-spec drives this service end-to-end (`listings-offer-status-snapshot.int-spec.ts` exercises the *repository* directly, not the service) — it is a precedent only for the snapshot table/repo plumbing.
- `createTestConnection(...)` from `test-connection.helper.ts` (the exported wrapper — `seedIntegrationCredential` itself is **private**) to seed the Erli connection + an **obviously-fake** credential (`{ apiKey: 'test-erli-key-not-real' }`), with explicit `adapterKey: 'erli.test.v1'`.

**New Components Required** (test-only):
- `apps/api/test/integration/helpers/erli-fake-http-client.ts` — programmable `IErliHttpClient` fake (scripts per-path responses; records sent requests `{method,path,body}` for assertions; supports sequenced GET responses to model async settle; `rejectNext(status, body?)` throws `ErliApiException(message, status, body?, url?)` — the **exact** typed error the real client raises, so the adapter's `instanceof ErliApiException` + `statusCode === 404` branches are exercised).
- `apps/api/test/integration/helpers/erli-test-offer-manager.helper.ts` — registers `erli.test.v1` adapterKey + a factory whose `createCapabilityAdapter(connection, …)` returns `new ErliOfferManagerAdapter(connection.id, 'erli.test.v1', fakeClient, cachePort)` (the **real** adapter — constructor is `(connectionId, adapterKey, httpClient, cache?)`; `identifierMapping` is **not** a ctor arg). Resolves `CACHE_PORT_TOKEN` from the harness for the 4th arg. Returns a handle exposing the fake for scripting/asserting.
- `apps/api/test/integration/erli/erli-offers-vertical-slice.int-spec.ts` — the suite.

**Core vs Integration Justification**: Pure test artifact. Faking at the **`IErliHttpClient` seam** (not the adapter seam) is the key decision — it keeps the real adapter's `buildCreateBody`, frozen-field suppression, status mapping, and variant-group emission under test, which is exactly what #991 must verify. Faking at the adapter level would bypass the logic the issue targets. The connection-scoped frozen-stock cache key depends on the adapter receiving the **correct `connection.id`** — the helper threads it from the resolver's `connection` arg (a wrong ctor wiring would make the cache key cross-tenant-ambiguous).

---

## 4. External / Domain Research

### Erli contract (from ADR-025 + shipped adapter)
- **Async writes**: POST/PATCH `/products/{externalId}` return HTTP 202; no read-after-write. `createOffer` maps to `'draft'` (not Allegro's `'validating'`) because Erli's ~20-min cache lag exceeds the creation poll budget.
- **Status mapping** (`getOfferStatus`): `active→active`, `accepted→activating`, `rejected→inactive` (+reason), `inactive→inactive`.
- **Frozen fields** (#988): live product carries `frozenFields[]`; `updateOfferFields` drops mapped keys (`price`/`name`/`description`) before PATCH. **Frozen stock** (#1066): per-offer cached flag (populated at status-read time) makes `updateOfferQuantity` a no-op when frozen.
- **Variant grouping** (#986/#1065): create body carries `externalVariantGroup.id` (parent product id, body-only) + `attributes[]` for multi-variant products; omitted for single/simple.
- **Taxonomy** (#985): create requires a resolved Allegro category (`source:"allegro"` reuse); missing → terminal `OfferCreateRejectedException`.

### Internal patterns
- **Faking strategy reference**: `allegro-test-offer-manager-stub.helper.ts` registers a synthetic adapterKey + factory; test connection created with that `adapterKey`; production `IntegrationsService.getCapabilityAdapter` resolves the test factory. We reuse the seam but return the **real** Erli adapter + fake client.
- **Async-lag in int-specs**: no fake timers anywhere in the suite. Reconciliation is proven by direct `OfferStatusSyncService.sync(...)` invocation + asserting `offer_status_snapshots`; "settle" is modelled by sequencing the fake's GET responses (`accepted` then `active`) across two `sync` calls.

---

## 5. Questions & Assumptions

### Open Questions
- **Q1**: Should the variant-grouping scenario assert the create **body shape** (recorded by the fake) only, or also a downstream "one grouped listing" effect? *Assumption*: assert body shape (`externalVariantGroup.id` + sorted `attributes[]`) — Erli does the actual grouping server-side; there is no OL-observable "one listing" artifact without live Erli. **Note (review I1)**: calling the adapter directly with a hand-built `CreateOfferCommand.variantGroup` exercises the adapter's `variantGroup → externalVariantGroup` mapping (#984/#986), **not** the #1065 `OfferBuilderService` populator (which *stamps* `variantGroup` and is unit-tested in `offer-builder.service.spec.ts`). S4 therefore validates the adapter side; #1065 is in the base for lockstep/completeness, not because S4 drives it. (Optional stretch: drive `OfferBuilderService` end-to-end — deferred to keep the suite tight.)
- **Q2**: How are the offer rows `OfferStatusSyncService.sync` pages over seeded? *Resolved*: `sync` pages via `OfferMappingRepositoryPort.findMany({connectionId},{limit,offset})`, which queries the **`identifier_mappings`** table scoped to `entityType='Offer'` (there is no `offer_mappings` table). Seed via `IdentifierMappingService.createMapping('Offer', externalId, connectionId, internalId)` where `externalId` is the Erli product id (`ol_variant_*`, so the fake's GET-by-path resolves) and `internalId` becomes the snapshot's `internalVariantId`.

### Assumptions
- The `apps/api` jest-integration `moduleNameMapper` already maps `@openlinker/integrations-erli` (confirmed present in `apps/api/test/jest-integration.cjs`), so no mapper edit is needed.
- **Scheduler gate (review I3)**: `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED` is **not currently set** in `setup.ts` (only the Allegro/inventory/product gates are). It reads falsy → disabled, so determinism holds today, but the plan **adds** `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false'` to `setup.ts` to match the file's explicit "disable all background schedulers" intent. The spec invokes the sync service directly regardless.
- Seller-variant-key ids match the adapter's `ol_variant_[a-f0-9]{32}` pattern; fixtures use conforming ids.

### Documentation Gaps
- Erli live response field names are #992-provisional; the spec encodes the **documented** shape and will be revisited if #992 contradicts it (noted inline in the spec).

---

## 6. Proposed Implementation Plan

### Phase 0: Base branch (DONE)
- **Branch**: `991-erli-offers-int-specs` created off `1065-erli-variant-group-populator`, with `1066-erli-frozen-stock` merged in (clean, signed, base `7fde1ec1`). Rationale: #991 must exercise both sibling features (variant grouping + frozen-stock quantity path), which live in disjoint sibling branches off #989.
- **Acceptance**: `git log` shows both siblings' code; `pnpm type-check` for core+erli clean (already verified pre-merge).

### Phase 1: Fake Erli HTTP client
1. **`erli-fake-http-client.ts`**
   - **File**: `apps/api/test/integration/helpers/erli-fake-http-client.ts`
   - **Action**: Implement `IErliHttpClient` (`get`/`post`/`patch`). Internal script map keyed by `method+path`; records every request (path + body) into a public `calls[]` log; supports `setProduct(externalId, productJson)` for GET reads and `enqueueGet(externalId, [resp1, resp2,…])` for sequenced reads (async-settle modelling). POST/PATCH resolve to a 202-equivalent success unless a rejection is scripted (`rejectNext(status, body)` → throws the same typed error the real client raises for 4xx/5xx, so the adapter's failure mapping is exercised).
   - **Acceptance**: implements the interface verbatim; no `any`; file header present.

### Phase 2: Test adapter registration helper
2. **`erli-test-offer-manager.helper.ts`**
   - **File**: `apps/api/test/integration/helpers/erli-test-offer-manager.helper.ts`
   - **Action**: `installErliOffersHarness(harness)` — resolve `ADAPTER_REGISTRY_TOKEN`, `ADAPTER_FACTORY_RESOLVER_TOKEN`, and `CACHE_PORT_TOKEN` from `harness.getApp()`; `register({ adapterKey: 'erli.test.v1', platformType: 'erli', supportedCapabilities: ['OfferManager'], isDefault: false })`; `registerFactory('erli.test.v1', { createCapabilityAdapter: (connection) => new ErliOfferManagerAdapter(connection.id, 'erli.test.v1', fakeClient, cachePort) })`. **Constructor is `(connectionId, adapterKey, httpClient, cache?)`** — `identifierMapping` is NOT a ctor arg (the production factory takes but discards it). The `connection.id` comes from the resolver's `connection` arg, so the frozen-stock cache key is correctly tenant-scoped. Return `{ fake, adapterKey }`.
   - **Acceptance**: connection created with `adapterKey: 'erli.test.v1'` resolves to the real adapter + fake client (+ live cache) through `IntegrationsService.getCapabilityAdapter`.

### Phase 3: The vertical-slice int-spec
3. **`erli-offers-vertical-slice.int-spec.ts`**
   - **File**: `apps/api/test/integration/erli/erli-offers-vertical-slice.int-spec.ts`
   - **Action**: `beforeAll` → `getTestHarness()` + `installErliOffersHarness`; `afterEach` → `resetTestHarness()`; `afterAll` → `teardownTestHarness()`. Seed an Erli connection (+ credential) via `test-connection.helper.ts`. Scenarios:
     - **S1 create → draft**: build a `CreateOfferCommand` (resolved Allegro category), call adapter `createOffer`; assert returned status `'draft'`; assert recorded POST body (`name`/`price`/`stock`/`barcode`/`externalCategories`).
     - **S2 sparse PATCH**: fake `setProduct` with current fields; call `updateOfferFields` changing only `name`; assert PATCH body contains `name` only.
     - **S3 quantity propagation**: call `updateOfferQuantity`; assert PATCH `{ stock }`. **Frozen-stock no-op (ordering matters)**: first `setProduct`/GET-script the fake to return `frozenFields:['stock']` and call `getOfferStatus(offerId)` (this is what populates `isStockFrozenCached` via the live `CachePort` — it is *not* set otherwise); *then* call `updateOfferQuantity` and assert the fake recorded **zero** PATCH calls. Requires the adapter to have been constructed with the real `cachePort` (Phase 2).
     - **S4 variant grouping**: multi-variant `createOffer` → assert body `externalVariantGroup.id` = parent product id + sorted `attributes[]`. Single-variant → grouping absent. (Exercises the adapter mapping, not the #1065 populator — see Q1.)
     - **S5 frozen-field + 0-stock**: fake product `frozenFields:['price']`; `updateOfferFields` with new price+name → PATCH omits `price`, includes `name`. Separate: `stock: 0` create → body `stock: 0` (lists as 0, not backfilled).
     - **S6 status reconciliation**: seed `identifier_mappings` (`entityType='Offer'`, `externalId='ol_variant_…'`, `connectionId`, `internalId`) via `IdentifierMappingService.createMapping`; script fake GET `accepted` then `active`; invoke `OfferStatusSyncService.sync(connectionId,{limit,offset:0})` twice; assert `offer_status_snapshots` transitions `activating → active` (Q2). New service-driven ground (no prior int-spec drives `sync`).
     - **S7 fail-closed id (review sec #3)**: call `createOffer`/`updateOfferFields` with a malformed `internalVariantId` (e.g. `ol_variant_../../etc`, or containing `/`); assert the adapter throws `ErliConfigException` and the fake recorded **zero** requests (`fake.calls.length === 0`) — proves the path-injection backstop sends nothing.
   - **Assertion-scope rule (review sec #5)**: assertions are limited to recorded request **paths/bodies** and `offer_status_snapshots` rows — never request headers or credential material (the bearer key is closed over inside the real client and never reaches the fake, so the test cannot read it).
   - **Acceptance**: all scenarios pass under `pnpm test:integration`; deterministic across repeated runs.

### Configuration / Migrations / Events
- **Config**: add `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false'` to `apps/api/test/integration/setup.ts` env (the only production-test-infra edit; the Erli gate is currently absent there). **Migration**: none (`offer_status_snapshots` exists). **Events**: none emitted by the test.

---

## 7. Alternatives Considered

- **A1 — Fake at the adapter level** (stub `OfferManagerPort` directly, like Allegro's offer-manager stub). *Rejected*: bypasses the exact adapter logic (#984/#985/#986/#988/#1065/#1066) #991 must verify. Allegro's stub exists to script *outcomes* for bulk-flow orchestration tests, a different goal.
- **A2 — Real Erli sandbox / Testcontainer**. *Rejected*: no Erli container exists; sandbox (#992) is not yet available and would make the suite non-deterministic and network-coupled.
- **A3 — Drive reconciliation via the scheduler** (register the Erli scheduler task + invoke bootstrap). *Rejected for v1*: heavier and timing-coupled; direct `OfferStatusSyncService.sync` invocation proves the same DB plumbing deterministically (matches `listings-offer-status-snapshot.int-spec.ts`).

---

## 8. Validation & Risks

### Architecture Compliance
- ✅ Test-only; uses production resolution seam; no boundary violations. Fake implements the published `IErliHttpClient` port.

### Naming Conventions
- ✅ `*.int-spec.ts`, helpers under `test/integration/helpers/`, spec under `test/integration/erli/` (per testing-guide PS-pattern precedent of platform subfolders).

### Risks
- **R1 — #992 field-name drift**: live Erli field names unconfirmed. *Mitigation*: assert documented shape; inline comment flags revisit-after-#992. Low blast radius (test-only).
- **R2 — Base-stack churn**: #991 sits atop 12 unmerged PRs; if a parent is force-pushed again, rebase #991. *Mitigation*: this is the top of the chain — nothing depends on it.
- **R3 — Suite weight on constrained CI**: one spec file, suite-scoped harness, no extra containers; bounded.

### Backward Compatibility
- ✅ No production code change; cannot break existing behaviour.

---

## 9. Testing Strategy & Acceptance Criteria

- **This issue *is* the test.** No new unit tests required; the int-spec is the deliverable.
- **Files**: `apps/api/test/integration/erli/erli-offers-vertical-slice.int-spec.ts` (+ 2 helpers).
- **Mocking strategy**: real `ErliOfferManagerAdapter` + fake `IErliHttpClient`; real Nest DI, Postgres, Redis via the shared harness.
- **Acceptance Criteria**:
  - [ ] Suite exercises create / sparse-update / quantity / variant-grouping / frozen-field+0-stock / status-reconciliation paths (S1–S6) + fail-closed id rejection (S7).
  - [ ] Credential fixtures use an obviously-fake API key (`test-erli-key-not-real` or similar); no real secret hardcoded; assertions never touch headers/credentials.
  - [ ] Runs green under `pnpm test:integration`; deterministic on repeated runs (no real timers).
  - [ ] No new ESLint/type errors (`pnpm lint`, `pnpm type-check`).
  - [ ] Fake + helper are reusable by the future orders int-spec (#998) where sensible.

---

## 10. Alignment Checklist

- [x] Follows hexagonal architecture (fakes a published port; real adapter under test)
- [x] Respects CORE vs Integration boundaries (test-only, production seam)
- [x] Uses existing patterns (`createIntegrationTestHarness`, adapter-registry stub helper)
- [x] Idempotency considered (reconciliation upsert asserted; resetTestHarness between tests)
- [x] Event-driven patterns N/A (no events emitted)
- [x] Rate limits & retries N/A (fake client; real retry logic unit-tested in #981)
- [x] Error handling covered (rejection path → `OfferCreateRejectedException`)
- [x] Testing strategy complete
- [x] Naming conventions followed
- [x] File structure matches standards
- [x] Plan is execution-ready

---

## Related Documentation
- [ADR-025: Erli marketplace adapter](../architecture/adrs/025-erli-marketplace-adapter.md)
- [Testing Guide](../testing-guide.md) — integration-test harness (`getTestHarness`/`resetTestHarness`), Testcontainers lifecycle, `*.int-spec.ts` conventions
- Reference helper: `apps/api/test/integration/helpers/allegro-test-offer-manager-stub.helper.ts`
