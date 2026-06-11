# Implementation Plan: Erli Plugin Skeleton + Static Manifest + Host Registration + ADR (#980, #983)

**Date**: 2026-06-11
**Status**: Ready for Review
**Estimated Effort**: 1–2 days
**Issues**: Closes #980, Closes #983
**Branch**: `980-983-erli-plugin-skeleton-adr`

---

## 1. Task Summary

**Objective**: Stand up the `libs/integrations/erli/` plugin package and wire it into both host apps — manifest, plugin descriptor, NestJS module, host registration. No capability logic yet; just the seam every other Erli issue (#981–#998) builds on. Additionally, author ADR-022 recording the non-obvious Erli architecture decisions (reconciliation-first posture, static API-key auth, Allegro-ID taxonomy reuse, asymmetric stock + frozen-field ownership) before the build leans on them.

**Context**: First slice of the Erli marketplace integration (product spec `docs/specs/product-spec-978-erli-marketplace-integration.md`, Gate D = YES, offers-first sequencing). A half-built Erli plugin in `main` is inert — it activates only when an operator creates an Erli connection — so this lands trunk-based as the first of ~12 small PRs.

**Classification**: Integration (new package) + App (registration seams) + Documentation (ADR).

---

## 2. Scope & Non-Goals

### In Scope
- New workspace package `@openlinker/integrations-erli` at `libs/integrations/erli/`.
- Static `erliAdapterManifest` (`adapterKey: 'erli.shopapi.v1'`, `platformType: 'erli'`, `supportedCapabilities: ['OrderSource', 'OfferManager']`, `displayName: 'Erli Shop API v1'`, `version: '1.0.0'`, `isDefault: true`).
- `createErliPlugin()` descriptor implementing the `AdapterPlugin` contract; `createCapabilityAdapter` throws a typed not-yet-implemented domain exception until #984/#993 land.
- `ErliIntegrationModule` via `createNestAdapterModule` (the easy path — skeleton needs no plugin-specific Nest providers).
- Registration in `apps/api/src/plugins.ts` + `apps/worker/src/plugins.ts`, jest-integration mapper entries in both apps, `tsconfig.base.json` path aliases.
- Unit tests mirroring `woocommerce-plugin.spec.ts` (manifest fields, static===runtime manifest identity, unsupported-capability error).
- ADR-022 (`docs/architecture/adrs/022-erli-marketplace-adapter.md`) + index row in the ADR README.
- `docs/architecture-overview.md` capability-matrix mentions for Erli.

### Out of Scope (own issues)
- `ErliHttpClient` (#981), connection validators/tester (#982), `ErliOfferManagerAdapter` (#984), `ErliOrderSourceAdapter` (#993), FE plugin (#990), all sync/webhook logic.

### Constraints
- Purely additive; no core or migration changes. No `OL_*` env vars needed.
- Until #982 lands, an Erli connection created via raw API has no shape validation and capability resolution throws the typed exception — acceptable for a dormant skeleton (no FE affordance exists either until #990).

---

## 3. Architecture Mapping

**Target Layer**: Integration (`libs/integrations/erli/`) + App registration seams.

**Capabilities involved**: `OfferManager`, `OrderSource` — declared in the manifest only; adapters arrive in #984/#993. Declaring them now matches the issue AC and lets `IntegrationsService.resolveAdapterMetadata` answer for Erli connections immediately.

**Existing components reused** (nothing new invented):
- `AdapterPlugin`, `HostServices`, `createNestAdapterModule` from `@openlinker/plugin-sdk` (`libs/plugin-sdk/src/adapter-plugin.ts`, `host-services.ts`, `create-nest-adapter-module.ts`).
- `AdapterMetadata` from `@openlinker/core/integrations` (`libs/core/src/integrations/domain/types/adapter.types.ts:54`).
- `PluginRegistryModule.forRoot` host composition (unchanged).

**Reference precedent**: WooCommerce (`libs/integrations/woocommerce/`) — the newest plugin, uses `createNestAdapterModule`, has the canonical manifest + plugin spec shape. Verified 2026-06-11; no `erli` token collisions anywhere in `libs/ apps/ scripts/ tsconfig.base.json`.

**Core vs Integration justification**: zero core edits; the plugin self-registers through the registry seams designed for exactly this (#570/#571/#593).

---

## 4. External / Domain Research

- **Erli Shop API**: REST over HTTPS, GET/POST/PATCH only, static API-key bearer auth, async writes (HTTP 202 + ~20-min cache lag), inbox-based order feed, no-retry/5 s webhooks. Docs: https://erli.pl/svc/shop-api/doc/. None of this is exercised by the skeleton — it shapes ADR-022 and the manifest capability set.
- **adapterKey convention**: `{platform}.{api}.{version}` — `woocommerce.restapi.v3`, `allegro.publicapi.v1`, `inpost.shipx.v1` → **`erli.shopapi.v1`** (matches the issue text and the Shop API product name).

---

## 5. Questions & Assumptions

### Assumptions (safe defaults)
1. **`register(host)` is a no-op in the skeleton.** Validators/tester arrive in #982; webhook translator in #996. The descriptor keeps the optional `register` hook absent (or empty) rather than stubbing registries with placeholders.
2. **`createCapabilityAdapter` throws `ErliCapabilityNotImplementedException`** (domain exception in `domain/exceptions/`) naming the capability and pointing at the tracking issue. This is more honest than `dispatchCapability` with an empty table (whose error message implies the capability is *unsupported*, while the manifest says it *is* supported — just not built yet).
3. **Worker registration included now.** WooCommerce/Allegro/PrestaShop register in both hosts; Erli's offer-creation jobs (#984) and inbox poll (#993) will run in the worker, so wiring both seams now avoids a guaranteed follow-up edit. DPD's worker-exclusion precedent doesn't apply (DPD is API-only by design).
4. **ADR-022 ships `Status: Accepted`** — issue #983's AC is "ADR merged, status Accepted", and this PR is the merge vehicle. (The generic plan-skill default of `Proposed` is overridden by the issue AC.)
5. **Capability-matrix note**: Erli is added as *Future Implementations* under `OfferManagerPort` and `OrderSourcePort` in `architecture-overview.md` (adapters don't exist yet), plus the plugin list mention. When #984/#993 land they move to *Current Implementations*.

### Open Questions
- None blocking. The sandbox-gated unknowns (#992) don't touch this slice.

---

## 6. Proposed Implementation Plan

### Phase 1 — Package scaffold
1. **`libs/integrations/erli/package.json`** — mirror WooCommerce: name `@openlinker/integrations-erli`, `main ./dist/index.js`, `types ./dist/index.d.ts`, exports `.` (CJS + types), deps `@openlinker/{core,plugin-sdk,shared} workspace:*`, peerDep `@nestjs/common ^10.0.0`, scripts (`build`, `test`, `lint`, `type-check`) copied from WooCommerce.
   - *Acceptance*: `pnpm install` links the package; `pnpm --filter @openlinker/integrations-erli build` compiles.
2. **`libs/integrations/erli/tsconfig.json`** (+ `jest.config` mirroring WooCommerce) — extends `../../../tsconfig.base.json`, `outDir ./dist`, `rootDir ./src`, references `../../core`, `../../shared`, `../../plugin-sdk`.
3. **`libs/integrations/erli/src/domain/exceptions/erli-capability-not-implemented.exception.ts`** — extends `Error`, message: `Erli capability "{capability}" is not implemented yet (see #984 / #993)`; file header per standards.

### Phase 2 — Manifest + descriptor + module
4. **`libs/integrations/erli/src/erli-plugin.ts`**
   - `export const erliAdapterManifest: AdapterMetadata = { adapterKey: 'erli.shopapi.v1', platformType: 'erli', supportedCapabilities: ['OrderSource', 'OfferManager'], displayName: 'Erli Shop API v1', version: '1.0.0', isDefault: true }`.
   - `export function createErliPlugin(): AdapterPlugin` returning `{ manifest: erliAdapterManifest, createCapabilityAdapter: () => Promise.reject(new ErliCapabilityNotImplementedException(capability)) }`.
   - *Acceptance*: static export and `createErliPlugin().manifest` are the **same object reference** (no drift — #575 pattern).
5. **`libs/integrations/erli/src/erli-integration.module.ts`** — `export const ErliIntegrationModule: DynamicModule = createNestAdapterModule({ plugin: createErliPlugin() });` (WooCommerce pattern, `woocommerce-integration.module.ts:20-22`).
6. **`libs/integrations/erli/src/index.ts`** — barrel exporting `erliAdapterManifest`, `createErliPlugin`, `ErliIntegrationModule`, the exception.

### Phase 3 — Host wiring (the 3-seam checklist from testing-guide #917)
7. **`tsconfig.base.json`** — add `@openlinker/integrations-erli` + `/*` path aliases (woocommerce shape).
8. **`apps/api/src/plugins.ts`** + **`apps/worker/src/plugins.ts`** — import + append `ErliIntegrationModule`.
9. **`apps/api/test/jest-integration.cjs`** + **`apps/worker/test/jest-integration.cjs`** — add the two mapper lines each (`^@openlinker/integrations-erli$` → `libs/integrations/erli/src/index.ts`, `^@openlinker/integrations-erli/(.*)$` → `…/src/$1`). The `check-jest-integration-mappers.mjs` guard under `pnpm lint` enforces this; a missing entry fails lint.

### Phase 4 — Tests
10. **`libs/integrations/erli/src/__tests__/erli-plugin.spec.ts`** — mirror `woocommerce-plugin.spec.ts`:
    - manifest fields (adapterKey/platformType/capabilities/isDefault),
    - `createErliPlugin().manifest === erliAdapterManifest` (reference identity),
    - `createCapabilityAdapter` rejects with `ErliCapabilityNotImplementedException` for `OfferManager`, `OrderSource`, and an unknown capability alike.

### Phase 5 — Documentation
11. **`docs/architecture/adrs/022-erli-marketplace-adapter.md`** — Status `Accepted`, sections per `template.md`: reconciliation-first posture (202 + cache lag + no-retry webhooks ⇒ inbox poll mandatory backstop, snapshot-reconciled offer status à la ADR-009); static API-key bearer vs Allegro OAuth2; Allegro-ID taxonomy reuse (`source:"allegro"`); asymmetric stock + `frozen` field ownership as adapter invariants. Alternatives: Erli-native taxonomy (rejected — kills the near-free-listing bet, spec R2), OAuth-style credential rotation (rejected — Erli has none), trusting 202 as confirmation (rejected — cache lag would lie to operators).
12. **`docs/architecture/adrs/README.md`** — add ADR-022 index row.
13. **`docs/architecture-overview.md`** — add `ErliOfferManagerAdapter` / `ErliOrderSourceAdapter` to the *Future Implementations* lists under `OfferManagerPort` / `OrderSourcePort`; link ADR-022.

### Phase 6 — Quality gate
14. Scoped first (resource-constrained machine): `pnpm --filter @openlinker/integrations-erli test`, then `pnpm lint`, `pnpm type-check`, full `pnpm test` before PR. No migration (`migration:show` not applicable — zero ORM entities).

---

## 7. Alternatives Considered

1. **Custom `@Module` + `onModuleInit` (Allegro/PrestaShop Shape A)** — rejected: that pattern exists for plugins carrying their own Nest providers (TypeORM repos, OAuth services). The skeleton has none; `createNestAdapterModule` is the documented easy path and WooCommerce proves it end-to-end. If a later Erli issue needs Nest providers, the module can be promoted then without changing the descriptor.
2. **Empty `supportedCapabilities: []` until adapters exist** — rejected: contradicts issue AC and would make `isDefault` registration pointless; the runtime gate at `IntegrationsService.getCapabilityAdapter` plus the typed not-implemented exception communicate the state honestly.
3. **Deferring the ADR to a docs-only PR** — rejected: #983 says the decisions should be recorded *before* the build leans on them, and a one-PR skeleton+ADR keeps Wave 0b atomic (also matches the user's one-branch-one-PR preference).

---

## 8. Validation & Risks

- **Architecture compliance** ✅ — plugin self-registration via plugin-sdk; zero core edits; no boundary crossings.
- **Naming** ✅ — `erli-plugin.ts`, `erli-integration.module.ts`, exception in `domain/exceptions/`, `{platform}.{api}.{version}` adapterKey.
- **Risk: unvalidated Erli connections pre-#982** — low; no FE affordance, capability use throws a typed error. Documented in §2.
- **Risk: routing/registration int-spec ripple** — `#998`'s AC warns manifest capability changes ripple into routing int-specs. For the skeleton, full `pnpm test` (unit) is the gate; existing integration suites don't enumerate platforms exhaustively (WooCommerce landed the same way). If CI's integration job flags a platform-enumeration assert, fix the fixture in this PR.
- **Backward compatibility** ✅ — purely additive.

---

## 9. Testing Strategy & Acceptance Criteria

- Unit: `erli-plugin.spec.ts` (Phase 4). No int-spec — there is no behavior beyond registration, and `createNestAdapterModule` is already covered by plugin-sdk + WooCommerce suites.
- AC (from #980): API + worker boot with Erli registered; manifest resolvable via `IntegrationsService`; static === runtime manifest; capability matrix lists Erli; tests green; zero new lint/type errors.
- AC (from #983): ADR-022 merged `Accepted`, linked from spec + architecture-overview, ADR index updated.

## 10. Alignment Checklist

- [x] Hexagonal architecture / CORE-Integration boundary respected (no core edits)
- [x] Existing patterns reused (`createNestAdapterModule`, WooCommerce precedent)
- [x] Idempotency / rate limits — N/A for skeleton (deferred to #981 by design)
- [x] Error handling — typed domain exception for the not-implemented seam
- [x] Naming + file structure per standards
- [x] Testing strategy complete; plan execution-ready
