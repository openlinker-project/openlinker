# Implementation Plan — #722 (Slice 1: integrations-credentials)

**Status**: Draft
**Issue**: [#722](https://github.com/SilkSoftwareHouse/openlinker/issues/722)
**Branch**: `722-integrations-credentials-rewire`
**Scope**: One slice of #722 — rewires every cross-context import of `IntegrationCredentialRepositoryPort` (from `apps/api` and `libs/integrations/allegro`) to consume `ICredentialsService` via the `CREDENTIALS_SERVICE_TOKEN` Symbol seam instead.

---

## 1. Goal

Drop 8 cross-context (file, symbol) allow-list entries from `scripts/check-cross-context-imports.mjs` by rewiring every consumer of `IntegrationCredentialRepositoryPort` outside `libs/core/src/integrations/**` to depend on the `ICredentialsService` cross-context CRUD seam (which was introduced for the same reason by #733 for the `ai` context).

Repository ports stay intra-context — that's the policy #721/#723 set up. The `integrations` repository port should be visible only to `integrations` infrastructure + integrations application services. Plugins and host apps must consume the service-interface seam.

**Scope vs #722.** This PR is **one slice** of #722's 64-entry allow-list. It closes one symbol class (`IntegrationCredentialRepositoryPort`, 8 entries) across all plugins+apps consumers. The remaining 56 entries — repository ports from other contexts — are tracked under the same issue and addressed in follow-up PRs. The PR body therefore uses **`Refs #722`**, not `Closes #722`.

## 2. Non-Goals

- Other slices of #722 (e.g. cross-context repository-port reaches into other contexts). Those are tracked as separate slices of the same issue — addressed in follow-up PRs.
- Changing the underlying repository port surface (`CredentialCreate`, `CredentialUpdate`, `getByRef`, `findByRef`, …). The service-interface method signatures are already 1:1.
- Renaming `credentialRepository` parameter/field names in tests — keep the rename to the smallest patch that lints cleanly (`credentials` reads better, but the rename can stay limited to the production files; spec mocks can keep their existing local names).

## 3. Verified Surface

`ICredentialsService` covers every call shape in the rewire target. The four methods exist on both contracts with identical signatures and identical error semantics:

| Caller method | `ICredentialsService` | `IntegrationCredentialRepositoryPort` | Error semantics |
|---|---|---|---|
| `create(payload)` | ✅ | ✅ | — |
| `update(ref, patch)` | ✅ | ✅ | both throw `CredentialNotFoundException` on absent ref |
| `delete(ref)` | ✅ | ✅ | both return `boolean` (`true` if deleted, `false` if absent) |
| `getByRef(ref)` | ✅ | ✅ | both throw `CredentialNotFoundException` on absent ref |

**Reads (`getByRef`) are 1:1, including on absent.** Audit of the four read sites in the two int-specs confirmed all of them already use `getByRef`, and the one absence assertion (`ai-provider-settings.int-spec.ts:320`) already uses `rejects.toBeInstanceOf(CredentialNotFoundException)` — the throws-on-absent shape that both interfaces carry. There is no `findByRef`-style nullable read on the repository port; the swap to `ICredentialsService.getByRef` is a literal token-only rewrite for those reads.

Reference consumption pattern: `libs/core/src/ai/application/services/ai-provider-key.service.ts:43-44` (introduced by #733).

## 4. Files to Change

### Production (4 files)

| File | Change |
|---|---|
| `apps/api/src/integrations/application/services/connection.service.ts` | Inject `ICredentialsService` via `CREDENTIALS_SERVICE_TOKEN`; replace `credentialRepository.{create,delete,update}` callsites |
| `apps/api/src/integrations/application/services/allegro-oauth.service.ts` | Same — single `create` callsite |
| `libs/integrations/allegro/src/infrastructure/token-refresh/allegro-token-refresh.service.ts` | Same — optional `update` callsite (keep `?` on constructor param) |
| `libs/integrations/allegro/src/allegro-integration.module.ts` | Factory provider injects `CREDENTIALS_SERVICE_TOKEN` instead of `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN` |

**Import-path constraint** (per `engineering-standards.md § Symbol DI Token Re-export Convention`, rule 3): every rewired file imports `ICredentialsService` and `CREDENTIALS_SERVICE_TOKEN` from the **top-level barrel** `@openlinker/core/integrations`. Deep paths like `@openlinker/core/integrations/integrations.tokens` are ESLint-blocked in `libs/integrations/**` and `apps/{api,worker}/**` and fail at Node runtime under #591.

### Specs (2 unit specs + 2 int specs)

| File | Change |
|---|---|
| `apps/api/src/integrations/application/services/connection.service.spec.ts` | Provide `CREDENTIALS_SERVICE_TOKEN` mock (4 methods) instead of repository token mock |
| `apps/api/src/integrations/application/services/allegro-oauth.service.spec.ts` | Same — single-method mock |
| `apps/api/test/integration/ai-provider-settings.int-spec.ts` | Resolve `CREDENTIALS_SERVICE_TOKEN` for credential reads in assertions |
| `apps/api/test/integration/connection-credentials.int-spec.ts` | Same |

### Lint invariants

| File | Change |
|---|---|
| `scripts/check-cross-context-imports.mjs` | Remove 8 (file, symbol) allow-list entries at lines 263–295 (the `IntegrationCredentialRepositoryPort` group) |

## 5. Step-by-step

1. **Rewire `connection.service.ts`** — swap field type/decorator + 3 callsites; the call shape stays identical. ✅ acceptance: `pnpm type-check` for `@openlinker/api` passes; the file no longer imports `IntegrationCredentialRepositoryPort` or `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN`.
2. **Rewire `allegro-oauth.service.ts`** — single field + single `create` callsite. ✅ same acceptance.
3. **Rewire `allegro-token-refresh.service.ts`** — keep optional `?`. The service is constructed by a factory in `allegro-integration.module.ts`, so the constructor stays manual (no DI decorator changes). ✅ same acceptance.
4. **Rewire `allegro-integration.module.ts`** — factory `inject:` array swaps the repository token for the service token; factory body passes `credentials` (the service) into `new AllegroTokenRefreshService(...)`. ✅ acceptance: module compiles; integration tests still bind the plugin.
5. **Rewire 2 unit specs** — providers use `CREDENTIALS_SERVICE_TOKEN`; jest mocks expose only the methods the unit tests actually exercise (`create`/`update`/`delete`). Cast the mock object to `jest.Mocked<ICredentialsService>` at provider-registration time so a future caller drift into `getByRef` would surface as a missing-method error in the test, not silently. (Stubbing every method on the interface would defeat that signal — the tradeoff favours minimal mocks here.) ✅ acceptance: `pnpm test` green for both files.
6. **Rewire 2 int specs** — resolve `CREDENTIALS_SERVICE_TOKEN` from the test module to read/write credentials in assertions. ✅ acceptance: `pnpm test:integration --testPathPattern='(ai-provider-settings|connection-credentials)\.int-spec\.ts'` green.
7. **Drop allow-list entries** — remove the 8 entries from `scripts/check-cross-context-imports.mjs:263-295`. ✅ acceptance: `pnpm check:invariants` green (now stricter — the invariant fails if any of the 4 production files re-import `IntegrationCredentialRepositoryPort`).
8. **Quality gate** — `pnpm lint && pnpm type-check && pnpm test`. ✅ all green.

## 6. Risk / Open Questions

- **Risk: Drift between repository port and service interface.** Mitigated by the fact that the rewire shrinks the surface — fewer cross-context callers means fewer code paths affected by future signature drift. The `ICredentialsService` interface is intentionally one-for-one with the repository port surface (see its file header). **Follow-up (out of scope here)**: file a follow-up issue to add a one-line invariant check (lint script or test) that asserts every public method on `IntegrationCredentialRepositoryPort` has a matching method on `ICredentialsService`. Without that guard, a future repository-port method added without a corresponding service-interface method would silently strand plugin consumers.
- **No DB / migration impact** — this is a refactor of dependency wiring only; no entity, schema, or seed change.
- **Allegro factory provider** — the only DI-graph surface touched in `libs/integrations`. The factory pattern stays the same; only the token in the `inject:` array swaps.

## 7. Validation

- `pnpm lint` (chains `check:invariants`) — green; the 8 allow-list entries removed
- `pnpm type-check` — green
- `pnpm test` — green for the two rewired unit specs
- `pnpm test:integration` (the two rewired int specs) — green
