# Pre-implement gate: `createOmsPlugin` descriptor + credential-less connection (#2405)

**Plan**: `docs/plans/implementation-plan-oms-plugin-descriptor.md`
**Base**: `origin/oms-programme-wave-3a` @ `c7ee984f1` · **Date**: 2026-08-31
**Scope**: read-only. No source file was modified by this gate.

## Verdict: **READY** (no Critical findings; 4 Warnings, each with a concrete mitigation)

---

## 1. Reuse audit

| Plan artifact | Verdict | Evidence |
|---|---|---|
| `AdapterMetadata.requiresCredentials` | **NEW in source** (see W1) | `adapter.types.ts` fields are `adapterKey`, `platformType`, `supportedCapabilities`, `displayName?`, `version?`, `isDefault?`, `variantGrouping?`, `defaultRateLimit?` |
| A resolver helper for it | **NEW** — but *rename*, see D-1 | no `adapterRequiresCredentials` anywhere |
| Any existing "adapter needs no credentials" mechanism | **ABSENT** — the opposite is enforced | `create-connection.dto.ts:34-45`, `connection.service.ts:333`, `create-connection.schema.ts:59-70` |
| `openlinker.oms.v1` / `platformType: 'openlinker'` manifest | **NEW** (docs-only mentions) | the `'openlinker'` literal in `apps/web` is an unrelated `AuthorityAnswerKind` (`who-decides-view.ts:116`) |
| `createOmsPlugin` / `omsAdapterManifest` / `OmsPluginDeps` / `OMS_*` constants | **NEW** | `libs/oms/src` holds only `index.ts`, `oms.module.ts`, `index.spec.ts` |
| FE plugin for `openlinker` | **NEW** | `apps/web/src/plugins/` has 10 dirs, none `openlinker` |
| `buildCreateConnectionSchema` | **PARTIAL -> extend** | `createConnectionSchema` is a module-level const (`create-connection.schema.ts:15`); the XOR refine at `:59-70` is what must be parameterised |
| Adapters query hook | **EXISTS -> reuse** | `features/adapters/hooks/use-adapters-query.ts`; note `AdapterSummary` is **not** in the feature barrel, consumers deep-import it |
| FE plugin registry | **EXISTS -> reuse** | `plugins/index.ts` + `define-plugin.ts`; convention is `id === platformType` |
| `AdapterResponseDto` | **ABSENT by design** | `adapter.controller.ts` returns `AdapterMetadata[]` raw, Swagger `type: [Object]` |

**No reuse collision.** Nothing the plan proposes to create already exists in source.

---

## 2. Backward-compatibility findings

### Critical: none

Every contract change is **additive**:

- `AdapterMetadata.requiresCredentials?` is optional. All 11 production manifest literals and ~25
  spec literals are `X: AdapterMetadata = {...}` or casts, and excess-property checks fire only on
  *unknown* properties, never on missing optional ones. `grep "satisfies AdapterMetadata"` and
  `"Record<keyof AdapterMetadata"` return **zero hits repo-wide**, so no exhaustive usage breaks.
  `isDefault?` / `variantGrouping?` / `defaultRateLimit?` are the shipped precedent.
- `libs/oms/src/index.ts` only gains exports.
- `AdapterSummary.requiresCredentials?` is optional; the two test files that build literals
  (`adapters-catalog-page.test.tsx:14,84`) are unaffected.
- `createConnectionSchema` is **retained** as the `requiresCredentials: true` case, so its single
  importer (`create-connection-form.tsx:9,61`) needs no signature change.

### W1 — a stale `libs/core/dist/` already declares the field (process hazard)

`libs/core/dist/integrations/domain/types/adapter.types.d.ts:13,15` already contains
`requiresCredentials?: boolean` and `resolveRequiresCredentials(...)`, leaked from the discarded
prior attempt. Source has neither. Cross-package `tsc` resolves `@openlinker/*` against built
`dist`, so a type-check could pass against the stale declaration rather than against what this
change actually writes — a green gate proving nothing.

**Mitigation (blocking, before the first gate run)**: `pnpm -r --filter "./libs/**" build` to
regenerate `dist` from source, and treat the cold `pnpm -r build` gate as the authority.

### W2 — `check-plugin-guide-quotes.mjs` pins `adapter.types.ts:38-77` by LINE RANGE

`scripts/check-plugin-guide-quotes.mjs:50-54` quotes that exact range verbatim into
`docs/plugin-author-guide.md`. Inserting anything **at or above line 77** (i.e. inside or above
`CoreCapabilityValues`) shifts the range and fails `pnpm check:invariants` with a diff that looks
unrelated to the change.

**Mitigation**: add `requiresCredentials?` beside `defaultRateLimit?` (~line 190, after the
interface's existing optional block) and the resolver at end of file, next to
`resolveVariantGroupingModel`. Both sit below the pinned range.

### W3 — exactly one existing assertion contradicts the relaxed guard

`connection.service.spec.ts:287` — *"should reject when neither credentials nor credentialsRef are
provided"* — asserts the behaviour this issue changes. It must be re-scoped to the
`requiresCredentials !== false` case, with a new sibling asserting the credential-less path.
`:278` (both provided) and `:271` (raw key without `db:`) are unaffected.

### W4 — one boot-spec assertion breaks under `OmsModule.register()`

Confirmed exactly one: `apps/worker/test/integration/oms-module-boot.int-spec.ts:73-77`
`expect(workerPlugins).toContain(OmsModule)` — identity-based, and the array would hold the
produced `DynamicModule`. **`typeof OmsModule === 'function'` and `OmsModule.name === 'OmsModule'`
both stay green** (a class carrying a static method is still a named function), as does
`libs/oms/src/index.spec.ts` in full. The plan's D4 is therefore correct, and its replacement —
asserting the adapter registry holds `openlinker.oms.v1` after boot — is a strictly stronger test
of the same property.

This file lives in `apps/worker/test/**`, excluded from `pnpm lint` and `pnpm type-check` (#786),
so it fails **only** under `pnpm test:integration`.

---

## 3. Checks that will NOT fire (verified, so they are not chased later)

- **`check-jest-integration-mappers.mjs`** parses `plugins.ts` with an import-statement-only regex
  (`:84`) and hardcodes `@openlinker/oms` in `REQUIRED_BASE` (`:69`). `OmsModule.register()` in the
  array does not break the parse. No other `check:invariants` script reads `plugins.ts`.
- **`.register()` in `plugins.ts` is already precedented** in both files —
  `AiIntegrationModule.register()` (`apps/api/src/plugins.ts:46`, `apps/worker/src/plugins.ts:48`).
- **`check-workspace-dep-declarations.mjs`** normalises `@openlinker/core/<ctx>` -> `@openlinker/core`,
  which `libs/oms/package.json` already declares, and `tsconfig.json` already references `../core`.
  **No manifest change is needed** for the five `I*Service` type imports.
- **`check-cross-context-imports.mjs`** classifies `libs/oms/src/**` as `{kind:'product'}` with **no
  same-context skip**, so every imported symbol must sit on the allowed contract surface. The
  planned imports all qualify: `I*Service` interfaces (allowed shape), `Connection` (published
  entity), `AdapterMetadata` (published type alias). Default and namespace imports are rejected
  outright — the plan uses neither.
- **`check-outbound-http.mjs`** has `libs/oms` in `SCAN_ROOTS`; the descriptor issues no HTTP.

---

## 4. Decision this gate revises

**D-1 — rename the resolver to `resolveRequiresCredentials`.** The plan proposed
`adapterRequiresCredentials`. The sibling helper in the *same file* is `resolveVariantGroupingModel`,
and the plan's own justification for exporting a runtime function from a `*.types.ts` rests on that
precedent (`engineering-standards.md` § the pure-rule exception, #2231). Matching its `resolve*`
prefix makes the citation exact rather than approximate. (The stale `dist` independently used the
same name, which is corroboration, not authority.)

---

## 5. Open questions

None blocking. Two things the plan already resolves explicitly, confirmed here against the tree:
the manifest ships `supportedCapabilities: []` (Erli #980 precedent; `AvailabilityAuthority` and
`FulfillmentExecutor` are in `CoreCapabilityValues` since #2403 but no manifest advertises them),
and the five factory deps are declared but not injected (`ShippingModule` / `MappingsModule` are
absent from the worker's shared spine, so injecting them would breach ADR-051's role guarantee).

One thing worth stating plainly rather than as a question: `GET /adapters` has no DTO, so
`requiresCredentials` becomes public API surface for free. That is convenient here — the FE needs
it — and pre-existing for `variantGrouping` / `defaultRateLimit`, so it is not a regression. But it
is a property of the route, not a design choice this issue made, and the next manifest field that
should *not* be public will need a real projection.
