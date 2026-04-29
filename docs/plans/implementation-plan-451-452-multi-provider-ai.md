# Implementation Plan — Multi-provider AI (#451 + #452)

## Goal

Make OpenLinker's AI completion layer support multiple providers (Anthropic + OpenAI), with the active provider switchable at runtime from the admin UI rather than via `OL_AI_PROVIDER` at boot. Per-provider API keys are stored independently so admins don't lose one when they switch to the other.

Closes #451 (add OpenAI) and #452 (runtime provider switch from admin UI). Bundled because #452 refactors the same module that #451 would otherwise add a static branch to — splitting forces rewriting `AiIntegrationModule` twice.

## Layer classification

- **CORE** (`libs/core/src/ai/`): types, ports, service interfaces, application services, persistence (new `ai_provider_settings` ORM entity + migration), domain exceptions
- **Integration** (`libs/integrations/ai/`): `VercelAiCompletionAdapter` parameterised by provider, new dispatcher adapter that resolves the active provider per call, `@ai-sdk/openai` package dep
- **Interface (API)** (`apps/api/src/ai/http/`): extend the controller surface — new endpoints for active provider + per-provider keys
- **Frontend** (`apps/web/src/features/ai-provider-settings/` + `pages/ai-provider-settings/`): provider table with per-row key form + "make active" action

## Non-goals

- Adding providers beyond Anthropic + OpenAI (Gemini, local models) — file separately
- Per-tenant or per-product provider routing
- Shadow/A-B traffic comparison between providers
- Changing how the credential ciphertext column is encrypted (existing `CryptoService` shape is preserved)
- Editing `OL_AI_PROVIDER` from the UI — env var becomes a first-boot default + fallback, never a runtime control
- Removing or renaming the legacy `ANTHROPIC_API_KEY` env-var fallback (kept; deprecation already messaged in code)

## Current-state recap (verified 2026-04-29)

- `AiProviderValues = ['anthropic', 'fake']` at `libs/core/src/ai/domain/types/ai-completion.types.ts:15`
- `AiIntegrationModule.register()` reads `process.env.OL_AI_PROVIDER` once and binds **one** of `FakeAiCompletionAdapter` / `VercelAiCompletionAdapter` to `AI_COMPLETION_PORT_TOKEN` — `libs/integrations/ai/src/ai-integration.module.ts:43-78`
- `VercelAiCompletionAdapter` already resolves the API key per request (`this.credentials.getApiKey()` inside `complete()`), with a 60 s in-port cache — `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.ts:123`
- `CredentialsAiProviderAdapter` reads `OL_AI_PROVIDER` once at construction and stores keys at `ref = ai-provider:{provider}` — already keyed by provider, but the `activeProvider` field is a constructor-time snapshot — `libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts:76`
- `AiProviderSettingsService.set/clear` always operate on the env-derived active provider — `libs/core/src/ai/application/services/ai-provider-settings.service.ts:107-110`
- HTTP surface today: `GET / PUT / DELETE /ai-provider-settings` on a single key slot tied to the active provider
- FE today: a single status card + single-key form; the page renders an Alert if `provider === 'fake'`

The runtime element is mostly already there for one provider. What's missing for #451 + #452 is:
1. `'openai'` in the value set + an OpenAI provider factory + Anthropic-specific code gated to `provider === 'anthropic'`
2. Active provider becoming a *persisted runtime setting*, read on every completion
3. Credentials port becoming per-provider rather than per-active-provider
4. New endpoints + FE for switching + per-provider key management

---

## Design

### Active provider: persisted runtime setting

New small persistence: `ai_provider_active_setting` (singular — singleton row, matches the `AiProviderActiveSetting` entity name; avoids future confusion if a separate `ai_provider_*` settings table appears).

```
ai_provider_active_setting
  id              text  PK   -- always 'singleton'
  active_provider text  NOT NULL
  updated_at      timestamptz
  updated_by      text  NULL
```

- Why a dedicated table (not reuse `integration_credentials`): the active-provider value is **not a secret** — encryption is overkill, and overloading the credentials table with a non-credential row is the kind of "just stuff it in" that drifts. A 4-column singleton is cheap and matches the existing repository-port pattern.
- Resolution at read time:
  1. Row exists → use it
  2. Row missing → fall back to `OL_AI_PROVIDER` env (validated through `AiProviderValues`); persist row implicitly on first admin write (no migration script needed)
  3. Env value also invalid/missing → default `'anthropic'`

### Provider-aware router (replaces static binding)

`AI_COMPLETION_PORT_TOKEN` resolves to a new `MultiProviderAiCompletionAdapter` that:
- Holds references to all real adapters (anthropic Vercel, openai Vercel, fake)
- On each `complete()` call: **reads the active provider from `IAiProviderActiveSettingsService` directly (no cache)**, picks the matching adapter, delegates
- The active-provider lookup is a singleton-row PK query — sub-millisecond against an indexed primary key. Compared to a 200–2000 ms LLM completion, the cost is invisible. Read-through avoids:
  - cross-process drift (two API workers routing to different providers for up to TTL seconds after a switch)
  - a circular DI between `AiModule` (where the active-settings service lives) and `AiIntegrationModule` (where the router lives) that an invalidator port would otherwise force
  - the existing 60 s `CredentialsAiProviderAdapter` key cache stays untouched — the key, unlike the active provider, *is* read-once-per-completion and worth caching

Naming note: `MultiProviderAiCompletionAdapter` deviates slightly from the strict `{System}{Capability}Adapter` pattern in `engineering-standards.md` because the router has no `{System}` — it's a meta-adapter that delegates to system adapters. Documented inline in the file header.

The two Vercel-backed adapters share an implementation. We parameterise `VercelAiCompletionAdapter` to accept a `provider: AiProvider` constructor argument and a provider factory token, so:
- Anthropic-specific cache-control on `system` message is gated by `if (this.provider === 'anthropic')`
- The model factory call (`createAnthropic` / `createOpenAI`) is selected per provider
- Default model id and max-tokens come from per-provider env vars: `OL_AI_DEFAULT_MODEL` (anthropic) / `OL_AI_OPENAI_MODEL` (openai), each with a hard-coded fallback. `gpt-4o-mini` is the working default for openai but confirm against `@ai-sdk/openai` at the version pinned in `package.json` at implementation time.

We instantiate two named instances, registered as separate providers in `AiIntegrationModule`. Both consume the same `AiProviderCredentialsPort` but call `getApiKey('anthropic')` / `getApiKey('openai')` respectively.

### Per-provider credentials port

`AiProviderCredentialsPort` becomes:

```ts
interface AiProviderCredentialsPort {
  getApiKey(provider: AiProvider): Promise<string>;     // throws AiProviderKeyMissingError
  describe(provider: AiProvider): Promise<AiProviderSettingsView>;
  describeAll(): Promise<AiProviderSettingsView[]>;     // for the new GET endpoint
  invalidate(provider?: AiProvider): void;              // omit = invalidate all
}
```

- The per-provider cache becomes a `Map<AiProvider, CacheEntry>`
- `ENV_VAR_BY_PROVIDER` extends with `openai: 'OPENAI_API_KEY'`
- `PROVIDERS_REQUIRING_KEY` extends with `'openai'`
- Storage shape unchanged — keys still live at `ref = ai-provider:{provider}` in `integration_credentials`

### Active-provider service

New `IAiProviderActiveSettingsService` (interface + impl) at `libs/core/src/ai/application/services/`:

```ts
interface IAiProviderActiveSettingsService {
  getActive(): Promise<AiProvider>;                            // resolved per the rules above
  setActive(provider: AiProvider, actorUserId?: string): Promise<void>;  // throws if target has no key configured
  describeAll(): Promise<MultiProviderSettingsView>;           // composite for GET endpoint
}

interface MultiProviderSettingsView {
  activeProvider: AiProvider;
  providers: AiProviderSettingsView[];                          // describeAll() from the credentials port
}
```

- `setActive` checks `credentials.describe(provider)` first; rejects with `AiProviderActivationError` if `configured === false` and the provider requires a key
- Persists the row, then invalidates the dispatcher's active-provider cache

### Settings services: split for honesty

The existing `IAiProviderSettingsService` contract is fully replaced — `set/clear/describe` now take a `provider` argument and the `get()` returns a multi-provider view. Rather than reuse the same interface name with a new shape (which silently breaks any caller still expecting the old contract), **split into two services**:

- `IAiProviderKeyService` — per-provider key CRUD: `setKey(provider, apiKey, actor)` / `clearKey(provider, actor)` / `describe(provider)` / `describeAll()`
- `IAiProviderActiveSettingsService` — active-provider selection: `getActive()` / `setActive(provider, actor)` / `getMultiProviderView()` (composite read used by `GET /ai-provider-settings`)

The old `IAiProviderSettingsService` interface is **deleted**, not renamed in place. Callers move to one of the two new interfaces; symbol token `AI_PROVIDER_SETTINGS_SERVICE_TOKEN` is replaced by `AI_PROVIDER_KEY_SERVICE_TOKEN` and `AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN`.

### HTTP surface

```
GET    /ai-provider-settings                                        → MultiProviderSettingsView   (breaking shape change vs. AiProviderSettingsView)
PUT    /ai-provider-settings/keys/:provider     body { apiKey }     → 204
DELETE /ai-provider-settings/keys/:provider                         → 204
PUT    /ai-provider-settings/active             body { provider }   → 204
```

The legacy `PUT /ai-provider-settings { apiKey }` and `DELETE /ai-provider-settings` are **removed**. The FE is the only known consumer and is updated in the same PR. **Breaking-change call-out**: the PR description must list the removed endpoints so any operator script (Ansible playbook, runbook curl, etc.) that depends on them is flagged for review. If post-merge feedback shows an external dependency, we add `PUT /` → `PUT /keys/{active}` aliases as a follow-up — cheap.

The `GET` shape change is also breaking — the FE feature slice owns its types and updates in lockstep.

### Frontend rebuild

The status card + single-key form is replaced with a **provider table**:

| Provider  | Active | Key configured | Source | Actions                       |
| --------- | ------ | -------------- | ------ | ----------------------------- |
| anthropic | ✓      | Yes            | db     | Set / rotate · Clear · –       |
| openai    |        | No             | none   | Set / rotate · –     · Make active |
| fake      |        | n/a            | none   | (no actions)                  |

- "Make active" is disabled for a provider with no key configured, with a tooltip explaining why
- "Set/rotate" opens a per-provider modal with the existing `Input type="password"` field
- "Clear" gated behind a `ConfirmDialog`, only visible when source === `db`
- Toast on every successful action; queries invalidated on success
- The "fake" provider is shown in the table but read-only — no key field, no activation gating beyond a confirmation that suggestions will return deterministic stubs

---

## Step-by-step plan

### Phase 1 — Domain types + active-provider persistence

1. **Extend the provider value set**
   - File: `libs/core/src/ai/domain/types/ai-completion.types.ts`
   - Change `AiProviderValues` to `['anthropic', 'openai', 'fake'] as const`
   - Update the surrounding doc comment to mention OpenAI

2. **Extend FE types** (kept in sync; no value-import from core)
   - File: `apps/web/src/features/ai-provider-settings/api/ai-provider-settings.types.ts`
   - Add `'openai'` to `AiProviderValues`
   - Add new types: `MultiProviderSettingsView`, `SetActiveProviderInput`

3. **New domain entity for active-provider setting**
   - File: `libs/core/src/ai/domain/entities/ai-provider-active-setting.entity.ts` (new)
   - Plain class `AiProviderActiveSetting { activeProvider: AiProvider; updatedAt: Date; updatedBy: string | null }`

4. **New repository port**
   - File: `libs/core/src/ai/domain/ports/ai-provider-active-setting-repository.port.ts` (new)
   - Methods: `findActive(): Promise<AiProviderActiveSetting | null>`, `upsertActive(setting): Promise<void>`

5. **New ORM entity + repository**
   - Files:
     - `libs/core/src/ai/infrastructure/persistence/entities/ai-provider-active-setting.orm-entity.ts` (new)
     - `libs/core/src/ai/infrastructure/persistence/repositories/ai-provider-active-setting.repository.ts` (new)
   - Singleton row pattern (`id = 'singleton'` PK), private `toDomain` / `toOrm`
   - Throws domain errors only — no `QueryFailedError` leaking

6. **New migration**
   - File: `apps/api/src/migrations/{ts}-AddAiProviderActiveSetting.ts`
   - Generate via `pnpm --filter @openlinker/api migration:generate -- src/migrations/AddAiProviderActiveSetting`
   - **Timestamp invariant** (`docs/migrations.md` §"Timestamp uniqueness invariant"): after generation, `ls apps/api/src/migrations | head -3` and verify the new 13-digit prefix doesn't collide with any existing file. If it does, bump both the filename prefix and the class suffix (`class AddAiProviderActiveSetting{TS} implements MigrationInterface`) to the next free millisecond before staging. `pnpm lint` runs `scripts/check-migration-timestamps.mjs` and will fail on a collision; run it locally before commit.
   - Verify with `pnpm --filter @openlinker/api migration:show` after running locally
   - Schema: `id text PK`, `active_provider text NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by text NULL`
   - No seed insert — first admin write creates the row; reads fall back to env

7. **New domain exception**
   - File: `libs/core/src/ai/domain/exceptions/ai-provider-activation.exception.ts` (new)
   - `AiProviderActivationError` thrown when `setActive` is called for a provider with no key configured. Message names *both* sources for the missing key — `OPENAI_API_KEY env unset; no DB row at ai-provider:openai` — so the operator can fix without trial-and-error.

### Phase 2 — Application services

8. **Refactor credentials port to be per-provider**
   - File: `libs/core/src/ai/domain/ports/ai-provider-credentials.port.ts`
   - Methods now take `provider: AiProvider`; new `describeAll()`; `invalidate(provider?)`

9. **Refactor `CredentialsAiProviderAdapter`**
   - File: `libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts`
   - Drop `activeProvider` field; per-provider cache map (60 s TTL retained — keys are read every completion call and rotation is rare)
   - `ENV_VAR_BY_PROVIDER`: add `openai: 'OPENAI_API_KEY'`
   - `getApiKey(provider)`, `describe(provider)`, `describeAll()` — iterate over `AiProviderValues`
   - One-shot deprecation warning for env fallback is now per-provider (each warns once)

10. **New active-provider service** — replaces the old `AiProviderSettingsService` for selection concerns
    - Files:
      - `libs/core/src/ai/application/services/ai-provider-active-settings.service.interface.ts` (new) — defines `IAiProviderActiveSettingsService`: `getActive()`, `setActive(provider, actor)`, `getMultiProviderView()`
      - `libs/core/src/ai/application/services/ai-provider-active-settings.service.ts` (new)
    - Implements `getActive()` (DB → env → default), `setActive(provider, actor)` (verifies key configured first via `IAiProviderKeyService.describe(provider)`; persists to repo; **no cache invalidation step — the router reads through**), `getMultiProviderView()` (composite read combining `getActive()` + `IAiProviderKeyService.describeAll()`)
    - Audit log on `setActive`: `ai_provider.set_active` with `{ fromProvider, toProvider, actor }`

11. **Replace settings service with `AiProviderKeyService`**
    - **Delete**: `libs/core/src/ai/application/services/ai-provider-settings.service.{ts,interface.ts,spec.ts}`
    - **New**: `libs/core/src/ai/application/services/ai-provider-key.service.{ts,interface.ts}`
    - `IAiProviderKeyService`: `setKey(provider, apiKey, actor)`, `clearKey(provider, actor)`, `describe(provider)`, `describeAll()` — pure per-provider CRUD over the credentials port; no notion of "active" lives here.
    - Reject `setKey/clearKey` for providers where `PROVIDERS_REQUIRING_KEY` is false (e.g. `fake`) → `AiProviderSettingsNotApplicableError(provider)` (existing exception, kept)
    - Audit log per write tagged with `{ provider, actor }`
    - **New** unit spec `ai-provider-key.service.spec.ts` (the old spec is deleted, not edited — different contract)

12. **Token rename + DI wiring in `AiModule`**
    - Files: `libs/core/src/ai/ai.tokens.ts`, `libs/core/src/ai/ai.module.ts`
    - **Replace** `AI_PROVIDER_SETTINGS_SERVICE_TOKEN` with `AI_PROVIDER_KEY_SERVICE_TOKEN`
    - **Add** `AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN`, `AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN`
    - Register the new ORM entity, repository, key service, active-settings service; export the service tokens

### Phase 3 — Router + per-provider Vercel adapter

13. **New router (multi-provider) adapter**
    - File: `libs/integrations/ai/src/infrastructure/adapters/multi-provider-ai-completion.adapter.ts` (new)
    - Class `MultiProviderAiCompletionAdapter implements AiCompletionPort`
    - File header documents the deviation from the strict `{System}{Capability}Adapter` naming pattern (see "Naming note" in Design above) — this is a meta-adapter that delegates to system adapters and has no `{System}`.
    - Holds: `Map<AiProvider, AiCompletionPort>` (the three concrete adapters) + injected `IAiProviderActiveSettingsService`
    - `complete(input)`: read active provider through-the-DB on every call → look up adapter in map → delegate. Log the resolved provider at `debug` per call (cheap, useful for diagnostic correlation; not at `log` level to avoid spamming).
    - If the resolved provider has no adapter registered (defensive — should be unreachable), throw `AiCompletionError("Unknown active provider")`
    - **No invalidator port, no cache** — read-through avoids a circular DI between `AiModule` and `AiIntegrationModule`.

14. **Parameterise `VercelAiCompletionAdapter`**
    - File: `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.ts`
    - Constructor takes a `provider: AiProvider` plus a provider factory function (passed via constructor closure or token; small enum → factory map keeps the adapter file from importing both SDKs at module-init for environments that only need one)
    - System-message cache-control is wrapped in `if (this.provider === 'anthropic') { … }` (OpenAI prompt-caching is auto-applied by OpenAI for prompts ≥1024 tokens with no SDK opt-in needed; documenting the deferral in the file header is enough)
    - Model default lookup uses per-provider env keys: `OL_AI_DEFAULT_MODEL` (anthropic) / `OL_AI_OPENAI_MODEL` (openai)
    - `this.credentials.getApiKey()` becomes `this.credentials.getApiKey(this.provider)`
    - The existing test override hook (`VERCEL_GENERATE_TEXT_FN_TOKEN`) stays the same

15. **Add `@ai-sdk/openai` package**
    - File: `libs/integrations/ai/package.json`
    - Add to `dependencies`. Pick a version line compatible with the existing `ai@^6.0.168` and confirm the working OpenAI default model name (`gpt-4o-mini` is the planned default; verify the SDK accepts it at the pinned version).

16. **Refactor `AiIntegrationModule`**
    - File: `libs/integrations/ai/src/ai-integration.module.ts`
    - Always register all three adapters (anthropic Vercel, openai Vercel, fake), each with a non-default token (`ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN`, `OPENAI_AI_COMPLETION_ADAPTER_TOKEN`, `FAKE_AI_COMPLETION_ADAPTER_TOKEN`)
    - Register the router; bind `AI_COMPLETION_PORT_TOKEN` to it via `useExisting`
    - The static branch on `OL_AI_PROVIDER` is removed (the env value still seeds the active provider on first boot via the active-settings service fallback)
    - Update the module's doc comment

### Phase 4 — HTTP surface

18. **Update controller**
    - File: `apps/api/src/ai/http/ai-provider-settings.controller.ts`
    - Replace existing `PUT /` and `DELETE /` with `PUT /keys/:provider` and `DELETE /keys/:provider`
    - Add `PUT /active` with body `{ provider }`
    - Adjust `GET /` response to `MultiProviderSettingsView`
    - Map `AiProviderActivationError` → 422 (Unprocessable Entity), keep `AiProviderSettingsNotApplicableError` → 400

19. **Update DTOs**
    - Files:
      - `apps/api/src/ai/http/dto/ai-provider-settings-response.dto.ts` — replace with `MultiProviderSettingsResponseDto`
      - `apps/api/src/ai/http/dto/update-ai-provider-settings.dto.ts` — keep, becomes body for `PUT /keys/:provider`
      - `apps/api/src/ai/http/dto/set-active-ai-provider.dto.ts` (new) — body for `PUT /active`, validates `IsIn(AiProviderValues)`
    - The `:provider` path param is validated with a small `@Param('provider')` + an `IsAiProvider` pipe / inline `IsIn` check

20. **Rewrite existing API integration spec** (the contract change is total; an extension would mislead)
    - File: `apps/api/test/integration/ai-provider-settings.int-spec.ts`
    - The existing assertions against the single-provider `AiProviderSettingsView` shape (lines 67-95) are deleted — under the new contract, `OL_AI_PROVIDER=fake` boot returns a multi-provider view with all three providers (`fake` configured=false / source=none, `anthropic` configured=false / source=none, `openai` configured=false / source=none) and the active provider set to `fake`.
    - Cover: `GET` returns the multi-provider view in the right shape; `PUT /keys/anthropic` with `OL_AI_PROVIDER=fake` env succeeds (env no longer gates writes — that was the old single-active-provider model); `PUT /keys/fake` returns 400 (`AiProviderSettingsNotApplicableError`); `PUT /active` to a provider with no key returns 422 (`AiProviderActivationError`); `PUT /active` to a provider with a key persists + the `GET` reflects the change; admin gate on every endpoint

### Phase 5 — Frontend rebuild

21. **API client**
    - File: `apps/web/src/features/ai-provider-settings/api/ai-provider-settings.api.ts`
    - New shape: `getAll()`, `setKey(provider, input)`, `clearKey(provider)`, `setActive(provider)`

22. **Query hooks + key factory**
    - Files:
      - `apps/web/src/features/ai-provider-settings/api/ai-provider-settings.query-keys.ts` (new minor)
      - `apps/web/src/features/ai-provider-settings/hooks/use-ai-provider-settings-query.ts` (rename target view)
      - `apps/web/src/features/ai-provider-settings/hooks/use-update-ai-provider-settings-mutation.ts` (now takes `{ provider, apiKey }`)
      - `apps/web/src/features/ai-provider-settings/hooks/use-clear-ai-provider-settings-mutation.ts` (now takes `{ provider }`)
      - `apps/web/src/features/ai-provider-settings/hooks/use-set-active-ai-provider-mutation.ts` (new)

23. **Components**
    - Replace `ai-provider-status-card.tsx` + `ai-provider-settings-form.tsx` with:
      - `ai-provider-table.tsx` (list view; one row per provider; "Make active" button)
      - `ai-provider-key-dialog.tsx` (modal with the existing single-field form; per-provider context)
      - `ai-provider-clear-dialog.tsx` (existing `ConfirmDialog` reused; per-provider context)
    - Keep the existing schema file `ai-provider-settings-form.schema.ts` (the field validation hasn't changed)
    - Component tests for the table + dialogs following the `.claude/rules/fe-pages.md` patterns (loading / error / empty / happy / interactions)

24. **Page**
    - File: `apps/web/src/pages/ai-provider-settings/ai-provider-settings-page.tsx`
    - Compose: `<PageLayout>` → `<AiProviderTable />` (no separate "fake" Alert — the table row carries the message)

### Phase 6 — Quality gate + docs

25. **Run** `pnpm lint && pnpm type-check && pnpm test` from the worktree root; fix at the root cause; never `--no-verify`

26. **Run integration spec** for `ai-provider-settings.int-spec.ts` and `content-editor-and-suggest.int-spec.ts` to confirm no regression — `pnpm test:integration`

27. **Update architecture doc**
    - File: `docs/architecture-overview.md` §13 (AI bounded context)
    - Replace "Selection: `OL_AI_PROVIDER` env (`anthropic` default; `fake` for tests)" with a description of the runtime active-provider setting + env fallback
    - Add a one-paragraph note about the dispatcher adapter and per-provider credential storage

---

## Test strategy

### Unit (`pnpm test`)

- `ai-completion-dispatcher.adapter.spec.ts` (new) — resolves the right adapter; cache invalidation flips the resolution; unknown provider throws
- `vercel-ai-completion.adapter.spec.ts` — extend existing spec with an OpenAI branch (mock `@ai-sdk/openai` like `@ai-sdk/anthropic` is mocked); verify cache-control header is **not** attached for `provider === 'openai'`
- `credentials-ai-provider.adapter.spec.ts` — parameterise existing assertions over both providers; cover `describeAll()`
- `ai-provider-settings.service.spec.ts` — extend for per-provider operations; reject `set` for providers where `PROVIDERS_REQUIRING_KEY` is false
- `ai-provider-active-settings.service.spec.ts` (new) — `setActive` rejects when target provider has no key; persists + invalidates on success; `getActive` resolves DB → env → default

### API integration (`pnpm test:integration`)

- `ai-provider-settings.int-spec.ts` — full HTTP surface (see step 20)
- `content-editor-and-suggest.int-spec.ts` — re-runs unchanged with the dispatcher in place; explicitly verifies `OL_AI_PROVIDER=fake` boot still produces deterministic output via the dispatcher

### Frontend (`pnpm test`, vitest)

- `ai-provider-table.test.tsx` — renders one row per provider; "Make active" disabled with tooltip when no key; clicking it triggers the mutation + invalidation
- `ai-provider-key-dialog.test.tsx` — submission forwards `{ provider }`; success toast; failure shows API error
- Existing `ai-provider-settings-page.test.tsx` updated for the new composition

---

## Architecture compliance check

- [x] Domain layer (`libs/core/src/ai/domain/`) has zero framework imports — new entities + ports keep the rule
- [x] Application services depend on **port interfaces** (`AiProviderActiveSettingRepositoryPort`, `AiProviderCredentialsPort`, `AiActiveProviderInvalidatorPort`); never on infra classes
- [x] ORM entities live only in `infrastructure/persistence/entities/`; mapping is private in repositories
- [x] Symbol tokens for all new ports + services; exported from `ai.tokens.ts`
- [x] Each new service ships an `I{Purpose}Service` interface in a separate `*.service.interface.ts`
- [x] Adapters under `infrastructure/adapters/`, named `{Platform}{Capability}Adapter`
- [x] No `any`, no inline types — `AiProvider` re-used everywhere; new types in `*.types.ts`
- [x] No `console.log` — `Logger` from `@openlinker/shared/logging`

## Risks + open questions

- **Risk (mitigated): cross-process drift on active provider**. Read-through (no router cache) means every API process picks up an active-provider switch on the very next completion call — no TTL window where two workers route to different providers. Cost: one extra PK lookup per completion (sub-millisecond on a singleton row). Compared to a 200–2000 ms LLM completion, the cost is invisible. The 60 s `CredentialsAiProviderAdapter` cache for keys is retained — different concern, low rotation rate.
- **Risk: OpenAI cache control**. `@ai-sdk/openai` does not support Anthropic's `cacheControl: { type: 'ephemeral' }`. The existing helpful behaviour for Anthropic is gated to `provider === 'anthropic'`. Tested explicitly. OpenAI's own auto-applied prompt cache for ≥1024-token prompts kicks in transparently; we accept whatever it gives us today.
- **Risk: env-fallback collision**. If both `OL_AI_PROVIDER=anthropic` *and* `ANTHROPIC_API_KEY` *and* a DB key for openai exist, the active-settings fallback resolves to anthropic on first boot — which is the legacy behaviour, so no regression. If the operator wants openai active, they must `PUT /active`.
- **Risk: breaking endpoint removal**. Legacy `PUT /ai-provider-settings` and `DELETE /ai-provider-settings` are removed in this PR. The PR description must list the change explicitly so any operator script depending on them is flagged. If post-merge feedback shows an external dependency, follow up with `PUT /` → `PUT /keys/{active}` aliases.
- **Decision**: `setActive('fake')` is allowed without a key (fake doesn't require one; `PROVIDERS_REQUIRING_KEY` check naturally permits it). Documented in the active-settings service.
- **Decision**: `MultiProviderSettingsView` includes `updatedAt` + `updatedBy` from the active-provider row so the UI can show "switched 2 h ago by alice@…". Cheap to add now, awkward to add later.

## Estimated diff surface

- ~12 new files (entity / port / repo / migration / dispatcher / active-settings service / new DTO / 4 FE files)
- ~10 modified files (types, credentials adapter, settings service, controller, AI module, integration module, Vercel adapter, FE api/hooks/page, architecture doc)
- 1 new package dep: `@ai-sdk/openai`
- 1 schema migration

Estimated ~half-day of focused work plus an evening of FE polish + integration test extension.
