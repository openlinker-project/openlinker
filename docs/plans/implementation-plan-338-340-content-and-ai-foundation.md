# Implementation Plan: Content & AI Foundation (#338 + #340)

**Date**: 2026-04-22
**Status**: Ready for Review
**Estimated Effort**: ~8–10 hours (backend-only: two new bounded contexts + one new integrations package + migration + tests)

**Issues**:
- [#338 feat(core): product content storage with draft write-through semantics](https://github.com/openlinker-project/openlinker/issues/338)
- [#340 feat(core): AI engine foundation — AiCompletionPort + Vercel AI SDK adapter](https://github.com/openlinker-project/openlinker/issues/340)

---

## 1. Task Summary

**Objective**: Lay down the two independent foundations of the Content & AI epic (#6):

1. **#338** — A `content/` bounded context with a `product_content_field` table and `ContentDraftService` providing draft-buffered writes, optimistic-concurrency reconcile, and publish-through for product content fields (master + per-connection overrides). First `fieldKey`: `description`.
2. **#340** — An `ai/` bounded context exposing a neutral `AiCompletionPort`, plus a new `libs/integrations/ai/` package containing a `VercelAiCompletionAdapter` (Anthropic via `ai` + `@ai-sdk/anthropic`) with system-prompt caching and a `FakeAiCompletionAdapter` for tests / offline dev.

**Why bundled**: Both are greenfield foundations of the same epic with no file overlap and no runtime interaction yet (the description-suggestion wiring in #342 joins them). Shipping together amortises the review overhead, locks consistent env-var naming (`OL_*`), and avoids an awkward half-epic intermediate state in `main`.

**Classification**: Pure **CORE + Integration** backend work. No frontend, no API controller surface in this PR (that arrives in #339 / #342).

---

## 2. Scope & Non-Goals

### In Scope — #338 (Content)
- New bounded context `libs/core/src/content/` following the standard hexagonal layout.
- Domain entity `ProductContentField`, types (`FieldKey` `as const` union, `ContentConflictInfo`), domain exceptions (`ContentConflictException`, `ContentFieldNotFoundException`, `ChannelContentPublishNotSupportedException`).
- Repository port + TypeORM implementation (`product_content_field` table).
- Migration `1789000000000-add-product-content-field-table.ts` with working `down()`.
- `IContentDraftService` interface + `ContentDraftService` implementation covering:
  - `saveDraft`, `discardDraft`, `publishDraft` (master path only for MVP — see §Out of scope for channel rationale), `reconcileExternal`, `resolveValue`.
- A small domain-layer helper service `ContentPublisher` (domain service, platform-agnostic) that the app service delegates publishing to. Concrete publish wiring uses `IntegrationsService.listCapabilityAdapters<ProductMasterPort>`.
- Exhaustive unit tests for the service (save/discard/publish/reconcile/resolve paths including conflict branches).
- One integration test proving the end-to-end write-through cycle against the Testcontainers harness.
- `ContentModule` wired into `AppModule`.

### In Scope — #340 (AI)
- New bounded context `libs/core/src/ai/` containing only domain surface (no application service — the port is consumed directly).
- `AiCompletionPort` interface (`ai-completion.port.ts`).
- Types in `ai-completion.types.ts`: `AiCompletionInput`, `AiCompletionResult`, `AiCompletionUsage`, `AiProviderValues`, `AiProvider`.
- Domain exceptions: `AiCompletionError`, `AiRateLimitError`, `AiInvalidResponseError`, `AiTimeoutError`.
- New workspace package `libs/integrations/ai/` mirroring the `integrations-allegro` layout (package.json, tsconfig.json, tsconfig.spec.json, jest.config.mjs, sequencer).
- `VercelAiCompletionAdapter` (`ai` + `@ai-sdk/anthropic`) applying `cache_control` on the system prompt when `cacheSystemPrompt !== false`.
- `FakeAiCompletionAdapter` used when `OL_AI_PROVIDER=fake`.
- `AiIntegrationModule` (NestJS) selecting the adapter based on env and binding `AI_COMPLETION_PORT_TOKEN` via `useExisting`.
- Structured logging via `@openlinker/shared/logging`: `{ requestId, model, latencyMs, inputTokens, outputTokens, cachedInputTokens }` per call.
- Unit tests for both adapters (Vercel adapter uses `generateText` mock; Fake adapter asserts deterministic returns + usage payload).
- Register `AiIntegrationModule` inside `apps/api/src/integrations/integrations.module.ts` (next to `AllegroIntegrationModule` + `PrestashopIntegrationModule`) — that's where every `@openlinker/integrations-*` module already lands. **Not** in `AppModule` directly.
- Add path aliases `@openlinker/integrations-ai` / `@openlinker/integrations-ai/*` to `tsconfig.base.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/jest.config.js`, `apps/api/test/jest-integration.cjs`.

### Out of Scope (deferred to follow-up issues)
- **Channel-path `publishDraft`** (writing per-marketplace overrides via `MarketplacePort.updateOfferFields`): requires offer-discovery from (productId, connectionId) and variant-to-offer mapping resolution, which is properly the listings bounded context's responsibility. For MVP we implement `connectionId=null` (master) fully and throw `ChannelContentPublishNotSupportedException` for `connectionId !== null`. The surface is correct; the wire is short. Explicit follow-up comment + TODO pointer to #339/#342.
- **Editing UI** (#339) and **AI description suggestion flow** (#342) — this PR is strictly backend scaffolding.
- **Additional field keys** beyond `description`: extension-point only (the `FieldKey` union is ready to grow).
- **Version history** beyond `(draftValue, baseValue)`.
- **Merge-resolution UI** — the conflict is surfaced as a persisted boolean + a domain event slot (event bus integration deferred until a consumer exists).
- **Per-user cost caps / rate limiting / streaming / tool use / RAG** for AI — flagged in #340.
- **Multi-provider AI adapter coexistence** — one Vercel SDK adapter + Fake adapter. Swap target remains the port.

### Constraints
- No `any`, no `console.log`, no framework imports inside `libs/core/src/**/domain/`.
- Env vars follow the existing `OL_*` convention (`OL_AI_PROVIDER`, `OL_AI_DEFAULT_MODEL`, `OL_AI_DEFAULT_MAX_TOKENS`, `OL_AI_TIMEOUT_MS`). `ANTHROPIC_API_KEY` keeps its vendor name (industry standard).
- No provider SDK types (`ai`, `@ai-sdk/*`) leak out of `libs/integrations/ai/`.
- All core + integration tests must pass `pnpm lint && pnpm type-check && pnpm test` at the end.
- Unique constraint on `(productId, connectionId, fieldKey)` must handle the nullable `connectionId` correctly (Postgres treats `NULL ≠ NULL` in uniques) → **two partial unique indexes** (one `WHERE connectionId IS NULL`, one `WHERE connectionId IS NOT NULL`) per the standard Postgres idiom. The `down()` drops both.

---

## 3. Research Summary

### Existing patterns located (authoritative file paths)
| Concern | File / Path |
|---|---|
| Bounded-context layout reference | `libs/core/src/products/` (domain/application/infrastructure folders + `products.module.ts` + `products.tokens.ts`) |
| Symbol-token + `useExisting` idiom | `libs/core/src/products/products.module.ts`, `libs/core/src/products/products.tokens.ts` |
| Migrations folder | `apps/api/src/migrations/` — latest is `1788000000000-promote-product-variant-entity-type.ts`; next slot is `1789000000000` |
| Entity auto-discovery glob | `apps/api/src/database/data-source.ts` — `libs/core/src/**/*.orm-entity{.ts,.js}` — new ORM entity will be discovered automatically |
| Integrations package exemplar | `libs/integrations/allegro/` — `package.json`, `tsconfig.json`, `tsconfig.spec.json`, `jest.config.mjs`, `test/openlinker.sequencer.cjs`, `src/allegro-integration.module.ts` (OnModuleInit factory registration pattern) |
| Adapter registration for `apps/api` | `apps/api/src/integrations/integrations.module.ts` imports `AllegroIntegrationModule` + `PrestashopIntegrationModule` |
| `tsconfig.base.json` alias list | path aliases currently wire `core`, `shared`, `integrations-allegro` — we add `integrations-ai` |
| Logger | `@openlinker/shared/logging` → `new Logger(ClassName.name)` |
| Env helpers (framework-free) | `@openlinker/shared/config` → `getEnv`, `getEnvNumber`, `getEnvBoolean` |
| NestJS env helper | `@nestjs/config` `ConfigService.get<T>()` pattern used in `apps/api/src/auth/bootstrap-admin.service.ts` |
| Integration test harness | `apps/api/test/integration/setup.ts` — `IntegrationTestHarness.reset()` truncates: `identifier_mappings`, `sync_jobs`, `inventory_items`, `order_records`, `product_variants`, `products`, `connections`, `users`. **We add `product_content_field` to that TRUNCATE list.** |
| Jest config for apps/api | `apps/api/jest.config.js` + `apps/api/test/jest-integration.cjs` both need the new `integrations-ai` alias |
| MarketplacePort / UpdateOfferFieldsCommand (for future channel publishing reference only) | `libs/core/src/integrations/domain/ports/marketplace.port.ts:70` + `libs/core/src/integrations/domain/types/marketplace-offer-update.types.ts` |
| ProductMasterPort.updateProduct + ProductUpdate type | `libs/core/src/products/domain/ports/product-master.port.ts` + `libs/core/src/products/domain/types/product.types.ts:67` — `ProductUpdate` already has `description?: string`, so the publish write is a one-field patch |
| Connection entity | `libs/core/src/identifier-mapping/domain/entities/connection.entity.ts` — `connectionId: string` |
| IntegrationsService API | `libs/core/src/integrations/…` — `listCapabilityAdapters<T>({ capability: 'ProductMaster' })` returns `{ connectionId, connection, adapter }[]` |

### What this unlocks
- Clean publish hook — `ContentDraftService.publishDraft()` → `ContentPublisher.publishMaster(productId, fieldKey, value)` → `IntegrationsService.listCapabilityAdapters<ProductMasterPort>({ capability: 'ProductMaster' })` → `adapter.updateProduct(productId, { [fieldKey]: value })`.
- AI port consumption — application services in #341/#342 will inject `AI_COMPLETION_PORT_TOKEN` and call `.complete(...)`.

### Dependencies added
- `ai` (Vercel AI SDK core) and `@ai-sdk/anthropic` — **only in `libs/integrations/ai/package.json`**. We pin to concrete versions (latest stable as of implementation) to keep the lockfile deterministic.
- No changes to root `package.json`.

---

## 4. Design

### 4.1 Bounded contexts after this PR

```
libs/core/src/
├── ai/                                    (NEW — domain-only)
│   ├── domain/
│   │   ├── ports/
│   │   │   └── ai-completion.port.ts
│   │   ├── types/
│   │   │   └── ai-completion.types.ts
│   │   └── exceptions/
│   │       ├── ai-completion.exception.ts
│   │       ├── ai-rate-limit.exception.ts
│   │       ├── ai-invalid-response.exception.ts
│   │       └── ai-timeout.exception.ts
│   ├── ai.tokens.ts                       (AI_COMPLETION_PORT_TOKEN)
│   └── index.ts
│
├── content/                               (NEW)
│   ├── domain/
│   │   ├── entities/
│   │   │   └── product-content-field.entity.ts
│   │   ├── ports/
│   │   │   ├── product-content-field-repository.port.ts
│   │   │   └── content-publisher.port.ts
│   │   ├── types/
│   │   │   └── content.types.ts           (FieldKey union, ContentConflictInfo)
│   │   └── exceptions/
│   │       ├── content-conflict.exception.ts
│   │       ├── content-field-not-found.exception.ts
│   │       └── channel-content-publish-not-supported.exception.ts
│   ├── application/
│   │   ├── services/
│   │   │   ├── content-draft.service.interface.ts            (interface lives next to its impl, per existing products convention)
│   │   │   ├── content-draft.service.ts
│   │   │   ├── content-draft.service.spec.ts
│   │   │   ├── integrations-content-publisher.service.ts     (implements ContentPublisherPort)
│   │   │   └── integrations-content-publisher.service.spec.ts
│   │   └── types/
│   │       └── content-draft.types.ts     (command DTOs)
│   ├── infrastructure/
│   │   └── persistence/
│   │       ├── entities/
│   │       │   └── product-content-field.orm-entity.ts
│   │       └── repositories/
│   │           ├── product-content-field.repository.ts
│   │           └── product-content-field.repository.spec.ts  (private mapping methods coverage via service-level tests is enough; spec omitted unless mapping edge case appears)
│   ├── content.module.ts
│   ├── content.tokens.ts                  (CONTENT_*_TOKEN family)
│   └── index.ts
```

```
libs/integrations/ai/                     (NEW — package)
├── package.json
├── tsconfig.json
├── tsconfig.spec.json
├── jest.config.mjs
├── test/openlinker.sequencer.cjs
└── src/
    ├── infrastructure/
    │   └── adapters/
    │       ├── vercel-ai-completion.adapter.ts
    │       ├── vercel-ai-completion.adapter.spec.ts
    │       ├── fake-ai-completion.adapter.ts
    │       └── fake-ai-completion.adapter.spec.ts
    ├── ai-integration.module.ts
    ├── ai.tokens.ts                       (re-exports core token for convenience; keep in core)
    └── index.ts
```

### 4.2 Data model

```sql
CREATE TABLE product_content_field (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),  -- OL-internal entity, not in identifier-mapping
  product_id    TEXT        NOT NULL
    REFERENCES products(id) ON DELETE CASCADE,
  connection_id UUID        NULL
    REFERENCES connections(id) ON DELETE CASCADE,        -- NULL = master
  field_key     TEXT        NOT NULL,                    -- MVP: 'description'
  draft_value   TEXT        NULL,
  base_value    TEXT        NULL,
  base_version  TEXT        NULL,                        -- opaque, platform-specific
  has_conflict  BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by    TEXT        NULL                         -- user id (string), nullable for system-driven reconcile
);

-- Postgres NULL-distinct uniqueness idiom: two partial indexes
CREATE UNIQUE INDEX ux_pcf_master
  ON product_content_field (product_id, field_key)
  WHERE connection_id IS NULL;

CREATE UNIQUE INDEX ux_pcf_channel
  ON product_content_field (product_id, connection_id, field_key)
  WHERE connection_id IS NOT NULL;

CREATE INDEX ix_pcf_product ON product_content_field (product_id);
```

### 4.3 Key interface shapes

```typescript
// libs/core/src/content/domain/types/content.types.ts
export const FieldKeyValues = ['description'] as const;
export type FieldKey = (typeof FieldKeyValues)[number];

export interface ContentConflictInfo {
  fieldKey: FieldKey;
  baseVersion: string | null;
  externalVersion: string;
}

// libs/core/src/content/application/types/content-draft.types.ts
export interface SaveDraftCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
  value: string;
  userId: string;
}
export interface DiscardDraftCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
}
export interface PublishDraftCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
}
export interface ReconcileExternalCommand {
  productId: string;
  connectionId: string | null;
  fieldKey: FieldKey;
  externalValue: string;
  externalVersion: string;
}
export interface ResolveValueQuery {
  productId: string;
  connectionId: string | null;      // null resolves master only
  fieldKey: FieldKey;
}

// libs/core/src/content/application/interfaces/content-draft.service.interface.ts
export interface IContentDraftService {
  saveDraft(cmd: SaveDraftCommand): Promise<ProductContentField>;
  discardDraft(cmd: DiscardDraftCommand): Promise<void>;
  publishDraft(cmd: PublishDraftCommand): Promise<ProductContentField>;
  reconcileExternal(cmd: ReconcileExternalCommand): Promise<ProductContentField>;
  resolveValue(q: ResolveValueQuery): Promise<string | null>;
}
```

```typescript
// libs/core/src/ai/domain/types/ai-completion.types.ts
export const AiProviderValues = ['anthropic', 'fake'] as const;
export type AiProvider = (typeof AiProviderValues)[number];

export interface AiCompletionInput {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  cacheSystemPrompt?: boolean;   // default true in adapter
  requestId?: string;
}
export interface AiCompletionUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}
export interface AiCompletionResult {
  text: string;
  usage: AiCompletionUsage;
  modelUsed: string;
  latencyMs: number;
}

// libs/core/src/ai/domain/ports/ai-completion.port.ts
export interface AiCompletionPort {
  complete(input: AiCompletionInput): Promise<AiCompletionResult>;
}
```

### 4.4 Publish routing logic

```
ContentDraftService.publishDraft(cmd)
  1. Load row (productId, connectionId, fieldKey). If draftValue == null → return row (no-op).
  2. If hasConflict → throw ContentConflictException (caller must reconcile + resaveDraft).
  3. Delegate to ContentPublisherPort.publish({ productId, connectionId, fieldKey, value: draftValue }).
  4. On success:
       baseValue = draftValue
       baseVersion = result.baseVersion   (returned by publisher)
       draftValue = null
       hasConflict = false
       updatedAt = now
       updatedBy = caller (reuse from last save) OR system marker
  5. Persist + return.

IntegrationsContentPublisher.publish(req)
  - connectionId == null → resolve ProductMaster adapter from IntegrationsService, call adapter.updateProduct(productId, { [fieldKey]: value }), read `updatedAt` or version-like field from returned Product as baseVersion.
  - connectionId != null → throw ChannelContentPublishNotSupportedException (deferred scope).
```

### 4.5 Reconcile logic

```
reconcileExternal(cmd)
  Find row. If not found → insert with baseValue=externalValue, baseVersion=externalVersion.
  If found:
    - draftValue == null → silent update: baseValue=externalValue, baseVersion=externalVersion, hasConflict=false.
    - draftValue != null && externalVersion > baseVersion → hasConflict=true, update baseValue+baseVersion to external (FE will render diff). Draft preserved.
    - draftValue != null && externalVersion == baseVersion → no-op (same origin).
```

`externalVersion > baseVersion` is a **string compare**: since we store platform-specific opaque markers, we don't perform ordering arithmetic — we treat any change from the stored `baseVersion` to a different `externalVersion` as a divergence. The `>` semantics in the issue is a simplification; the implementation is "divergence when strings differ" (documented in code comments).

### 4.6 AI adapter behaviour

- `VercelAiCompletionAdapter.complete(input)`:
  - Defaults: `model = OL_AI_DEFAULT_MODEL (claude-opus-4-7)`, `maxOutputTokens = OL_AI_DEFAULT_MAX_TOKENS (2048)`, `temperature = 0.2`, `cacheSystemPrompt = true`, timeout = `OL_AI_TIMEOUT_MS (60000)`.
  - Calls `generateText({ model: anthropic(model), system: systemPrompt, prompt: userPrompt, maxOutputTokens, temperature, providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } })` when `cacheSystemPrompt`.
  - Wraps in `AbortController` for timeout → on timeout → `AiTimeoutError`.
  - Maps provider errors by shape (rate-limit 429 → `AiRateLimitError`; other → `AiCompletionError`). Uses duck-typed detection (`error.statusCode === 429` or string match) to avoid importing provider error types into the adapter boundary check.
  - Logs `{ requestId, model, latencyMs, inputTokens, outputTokens, cachedInputTokens }`.
  - **Anthropic cache threshold note (in adapter file header):** the Anthropic prompt cache silently no-ops `cache_control` when the cached prefix is below ~1024 input tokens. The adapter applies the marker unconditionally when `cacheSystemPrompt` is true; `cachedInputTokens === 0` on first call is **expected behaviour**, not a bug. Repeated calls with a sufficiently long system prompt should observe `cachedInputTokens > 0` after the first warm-up.
- `FakeAiCompletionAdapter.complete(input)`:
  - Returns `text = \`fake: \${input.userPrompt.slice(0, 120)}\`` (deterministic from input).
  - `usage.inputTokens = Math.ceil(systemPrompt.length / 4)`, `outputTokens = Math.ceil(text.length / 4)`, `cachedInputTokens = 0`.
  - `modelUsed = 'fake-model'`, `latencyMs = 1`.
  - Useful for unit tests consuming the port without touching the network.

### 4.7 Module wiring

- `ContentModule` (core): providers = `ProductContentFieldRepository`, `ContentDraftService`, `IntegrationsContentPublisher`, plus token bindings; exports token bindings + `ContentDraftService` via token.
- `AiIntegrationModule` (integrations): reads `OL_AI_PROVIDER` (default `'anthropic'`; `'fake'` selects the fake adapter). Provides the chosen adapter as concrete class + binds `AI_COMPLETION_PORT_TOKEN` via `useExisting`.
- `AppModule`: add `ContentModule` + `AiIntegrationModule` to imports.

### 4.8 Env vars introduced
| Var | Default | Consumer |
|---|---|---|
| `OL_AI_PROVIDER` | `anthropic` | `AiIntegrationModule` (adapter selection) |
| `OL_AI_DEFAULT_MODEL` | `claude-opus-4-7` | `VercelAiCompletionAdapter` |
| `OL_AI_DEFAULT_MAX_TOKENS` | `2048` | `VercelAiCompletionAdapter` |
| `OL_AI_TIMEOUT_MS` | `60000` | `VercelAiCompletionAdapter` |
| `OL_AI_LOG_PROMPT` | `false` | `VercelAiCompletionAdapter` (debug-only — when true, logs raw prompt + response text in addition to metadata) |
| `ANTHROPIC_API_KEY` | — (required when provider=anthropic) | `VercelAiCompletionAdapter` |

`.env.example` is updated.

---

## 5. Step-by-step Implementation Plan

### Phase A — Plumbing (path aliases, scaffold empty package)
- **A1.** Add `@openlinker/integrations-ai` alias pairs to `tsconfig.base.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`, `apps/api/jest.config.js`, `apps/api/test/jest-integration.cjs`. **AC**: `pnpm type-check` still green from the repo root.
- **A2.** Create `libs/integrations/ai/` skeleton: `package.json` (name: `@openlinker/integrations-ai`, deps `@openlinker/core`, `@openlinker/shared`, `ai@latest-stable`, `@ai-sdk/anthropic@latest-stable`; peerDep `@nestjs/common`), `tsconfig.json`, `tsconfig.spec.json`, `jest.config.mjs`, `test/openlinker.sequencer.cjs` — all mirrored from the allegro package. **AC**: `pnpm install` resolves the new workspace package without error.
- **A3.** Add `@openlinker/integrations-ai` to `apps/api/package.json` dependencies (workspace:*). **AC**: `pnpm install` linked.

### Phase B — AI core (#340)
- **B1.** `libs/core/src/ai/domain/types/ai-completion.types.ts` + `…/ports/ai-completion.port.ts` + 4 exception files + `ai.tokens.ts` (exports `AI_COMPLETION_PORT_TOKEN = Symbol('AiCompletionPort')`). `index.ts` re-exports. **AC**: files compile; domain has zero framework imports.
- **B2.** `libs/integrations/ai/src/infrastructure/adapters/fake-ai-completion.adapter.ts` + its `.spec.ts`. **AC**: spec asserts deterministic return payload for a fixed input.
- **B3.** `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.ts`. Uses `generateText` from `ai` + `anthropic` from `@ai-sdk/anthropic`. Reads env via `ConfigService`. Structured logs via `Logger`. Timeout + error mapping. **AC**: spec mocks `ai.generateText` (via `jest.mock('ai')`) and asserts the adapter forwards model + maxOutputTokens, applies cache-control when `cacheSystemPrompt` is true (default), surfaces timeout as `AiTimeoutError`, and maps `statusCode 429` → `AiRateLimitError`.
- **B4.** `libs/integrations/ai/src/ai-integration.module.ts` — NestJS module selecting the adapter via `OL_AI_PROVIDER`. Binds `AI_COMPLETION_PORT_TOKEN` with `useExisting`. **AC**: module file compiles, exports `AI_COMPLETION_PORT_TOKEN` via `useExisting`.
- **B5.** `libs/integrations/ai/src/index.ts` exports module + adapters (adapters exported only for testing — callers consume the port via token).
- **B6.** Register `AiIntegrationModule` in `apps/api/src/integrations/integrations.module.ts` (next to `AllegroIntegrationModule` + `PrestashopIntegrationModule`). **Not** `AppModule` — every other `@openlinker/integrations-*` module sits in the api-level `IntegrationsModule`.

### Phase C — Content core (#338)
- **C1.** Domain surface: `libs/core/src/content/domain/types/content.types.ts`, `…/entities/product-content-field.entity.ts`, `…/ports/product-content-field-repository.port.ts`, `…/ports/content-publisher.port.ts`, 3 exception files. **AC**: domain has zero framework imports.
- **C2.** ORM entity `libs/core/src/content/infrastructure/persistence/entities/product-content-field.orm-entity.ts` with the columns from §4.2 and correct indexes via `@Index(...)` decorators. **Note**: the two partial-unique indexes must be created in the migration (TypeORM decorator support for partial/filtered indexes is fragile — safer to define them in migration SQL).
- **C3.** Migration `apps/api/src/migrations/1789000000000-add-product-content-field-table.ts` with `up()` creating table + indexes and `down()` dropping them cleanly.
- **C4.** Repository `…/infrastructure/persistence/repositories/product-content-field.repository.ts` implementing the port (`findByKey`, `upsert`, `delete`). Private `toDomain` / `toOrm`. **PK is a plain UUID** generated by Postgres `gen_random_uuid()` (default on the column) — `ProductContentField` is an OL-internal entity with no external-ID counterpart, so it intentionally does not participate in `IdentifierMappingService` and does not carry an `ol_*` prefix. Avoids the visual ambiguity of mixing `ol_*` IDs with rows that have no identifier-mapping presence.
- **C5.** Application service `ContentDraftService` implementing `IContentDraftService` (§4.3). All methods. Publishes via injected `ContentPublisherPort` (token: `CONTENT_PUBLISHER_PORT_TOKEN`).
- **C6.** Concrete publisher `IntegrationsContentPublisher` implements `ContentPublisherPort`. Depends on `IntegrationsService` to resolve the `ProductMasterPort` adapter. Handles master path. Throws `ChannelContentPublishNotSupportedException` for non-null `connectionId` with a clear message pointing at #339/#342.
- **C7.** `content.tokens.ts` (`PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN`, `CONTENT_DRAFT_SERVICE_TOKEN`, `CONTENT_PUBLISHER_PORT_TOKEN`) + `content.module.ts` wiring everything + `index.ts` re-exports.
- **C8.** Register `ContentModule` in `apps/api/src/app.module.ts` imports. (Core bounded context, sits at app-level alongside `ProductsApiModule`, `OrdersModule`, etc.)
- **C9.** Add `product_content_field` to the integration-harness TRUNCATE list in `apps/api/test/integration/setup.ts`. Since the entity has FKs to `products` and `connections`, put it **before** those in the truncate order.
- **C10.** Worker registration (`apps/worker/`) is **deferred**. `ContentDraftService.reconcileExternal` is the natural call site for inbound sync handlers, but no consumer exists yet — wiring it before #339/#342 land would create a dead provider in the worker module. Tracked as a follow-up note in the AI/Content sections of architecture-overview.md.

### Phase D — Tests
- **D1.** Unit tests `content-draft.service.spec.ts`:
  - `should create row with draftValue when no row exists` (saveDraft fresh).
  - `should update draftValue and preserve baseValue/baseVersion when row exists` (saveDraft on existing row).
  - `should clear hasConflict when a new draft is saved over a previously-conflicted row (implicit acknowledgement)` — explicitly documents the policy that re-saving acts as user acknowledgement of the divergence; future `acknowledgeConflict` action could split this if the FE needs separate semantics.
  - `should null draftValue on discardDraft` and `should be a no-op when no row exists`.
  - `should be a no-op when publishDraft is called with no pending draft`.
  - `should throw ContentConflictException when publishDraft is called on a conflicted row`.
  - `should call ContentPublisherPort.publish, set baseValue=draftValue, null draftValue, and update baseVersion on successful publish`.
  - `should silently update baseValue and baseVersion on reconcileExternal when no draft exists`.
  - `should mark hasConflict=true on reconcileExternal when draft exists and external version differs from base`.
  - `should be a no-op on reconcileExternal when external version equals base version` (same-origin replay).
  - `should resolve master draftValue, then master baseValue, then null when connectionId=null`.
  - `should resolve channel draft, channel base, master draft, master base, then null when connectionId is provided`.
- **D2.** Unit test `integrations-content-publisher.service.spec.ts`: master path resolves `ProductMaster` and calls `updateProduct(productId, { description: 'new' })`; channel path throws `ChannelContentPublishNotSupportedException`.
- **D3.** Adapter unit tests for AI (B2, B3 above).
- **D4.** Integration test `apps/api/test/integration/content-draft.int-spec.ts`:
  - Seed a connection + a product (via harness helpers or direct SQL inserts if helpers missing).
  - Save draft → assert row exists with `draftValue`.
  - Reconcile with same-version external → no-op.
  - Reconcile with different external version → row has `hasConflict=true`.
  - Save a new draft → `hasConflict=false`.
  - Publish draft path: stub the `ContentPublisherPort` (not the underlying `IntegrationsService`) via `Test.createTestingModule().overrideProvider(CONTENT_PUBLISHER_PORT_TOKEN).useValue({ publish: jest.fn().mockResolvedValue({ baseVersion: '...' }) })` — this is the lowest-blast-radius override, avoids touching adapter-factory test helpers (whose surface for arbitrary capability overrides isn't established yet), and keeps the publish path testable end-to-end at the row level. After the call, assert `draftValue=null`, `baseValue=draft`, `baseVersion=stub-version`.
  - Use `resetTestHarness()` between tests per `docs/testing-guide.md`.

### Phase E — Docs + env
- **E1.** Update `.env.example` (or equivalent) with the five new env vars and comments.
- **E2.** Extend `docs/architecture-overview.md` — add a short Content bounded context section (the table already has slots 1–10; add §11 Content) + a short AI section (§12). One paragraph each + the public port surface.
- **E3.** No changes to `engineering-standards.md` — patterns followed, no new standard introduced.

### Phase F — Quality gate
- **F1.** `pnpm lint` — zero errors.
- **F2.** `pnpm type-check` — zero errors.
- **F3.** `pnpm test` — all unit suites green.
- **F4.** `pnpm test:integration --testPathPattern=content-draft.int-spec` — new suite green (only run the content one to validate the addition; the rest run in CI).
- **F5.** `pnpm --filter @openlinker/api migration:show` — confirms the new migration is detected + unapplied on a clean DB.

---

## 6. Validation Checklist (before commit)

Architecture
- [ ] Domain folders (`libs/core/src/{ai,content}/domain/**`) import only from `@openlinker/core/**/domain/**` and `@openlinker/shared/**` (no NestJS, no TypeORM).
- [ ] Adapters implement ports, not vice-versa.
- [ ] Service → repository **port** (not concrete class); module binds via symbol token + `useExisting`.
- [ ] No provider SDK type (`ai`, `@ai-sdk/*`) appears outside `libs/integrations/ai/src/infrastructure/adapters/`.
- [ ] `ContentDraftService` depends on `ContentPublisherPort` (not on `IntegrationsService` directly).

Naming + file conventions
- [ ] Ports: `*.port.ts` → `{Capability}Port`. Adapters: `*-adapter.ts` → `{Platform}{Capability}Adapter`.
- [ ] Service interface in `*.service.interface.ts`; implementation in `*.service.ts`.
- [ ] Types in `*.types.ts`. Exceptions in `domain/exceptions/*.exception.ts`.
- [ ] File-header block on every new source file (purpose + `@module` tag).

TS / lint
- [ ] No `any`. `unknown` + narrowing where necessary.
- [ ] No `console.log`. Logger everywhere.
- [ ] Explicit return types on public methods.

Migrations
- [ ] `up()` idempotent with `IF NOT EXISTS` guards.
- [ ] `down()` drops the two partial unique indexes + the table in reverse order.
- [ ] Migration timestamp is monotonic. **Re-confirm at commit time** by running `ls apps/api/src/migrations/ | sort | tail -1`; bump the new migration's timestamp if a later migration has merged from `main` since this plan was written.

Tests
- [ ] Unit test files sit next to their subject (`*.spec.ts`).
- [ ] Integration test added to `apps/api/test/integration/` as `*.int-spec.ts`.
- [ ] `resetTestHarness()` is called between integration test cases.
- [ ] `product_content_field` is truncated in `IntegrationTestHarness.reset()`.

Security
- [ ] `ANTHROPIC_API_KEY` is read from env, never logged.
- [ ] No secrets checked into `.env.example` (only var names + placeholder comments).
- [ ] No raw prompt or response body logged (we log metadata + token counts only; actual prompt text is debug-only gated by `OL_AI_LOG_PROMPT=true` env flag).

Docs
- [ ] `docs/architecture-overview.md` updated with Content + AI sections.
- [ ] `.env.example` updated.

---

## 7. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Two partial-unique indexes may surprise future contributors accustomed to a single unique constraint. | One-line comment in the migration + a note in the ORM entity header. |
| `base_version` semantics are platform-specific. The `>` comparison in the issue is informal. | Explicit code comment: "divergence = string inequality"; adapters pass whatever opaque version marker they have (`date_upd` for PS, `revision` for Allegro). |
| Vercel AI SDK major-version churn could break us. | Pin to a specific minor in the `integrations-ai` package.json. Version bumps are a deliberate PR. |
| Fake adapter responses might accidentally satisfy real-adapter tests. | Fake adapter always prefixes `fake:` and real-adapter tests mock `generateText` rather than using the Fake. |
| Channel-path publish is deferred — if a caller wires `connectionId != null` today they'll get an exception. | Exception message explicitly references follow-up issues. Integration test covers both branches. |
| Prompt-cache hit rate isn't validated in this PR (requires live Anthropic call). | Caching is applied at the call site; the first consumer (#342) will observe `cachedInputTokens > 0` in logs. Acceptance for #340 only requires the adapter applies cache control correctly (unit-testable via mocked SDK call arguments). |

### Open questions (non-blocking)
- Do we want `updated_by` to FK to `users.id`? For MVP it's a free-text string to keep the table self-contained and to allow system-driven reconciles (`updatedBy = 'system'`). Cheap to tighten later if needed.
- Should `OL_AI_LOG_PROMPT` default to `false` (privacy) or `true` in dev? Defaulting to `false` — only the metadata logs fire by default. Devs can opt in for debugging.
