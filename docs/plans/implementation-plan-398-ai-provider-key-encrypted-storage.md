# Implementation Plan — #398 AI provider API key in encrypted credentials store

## 1. Goal

Stop reading `ANTHROPIC_API_KEY` directly from `process.env` inside the AI completion adapter. Instead, resolve it through a port whose default implementation looks the value up in the existing encrypted `integration_credentials` table, falling back to the environment variable for local dev. Surface admin REST endpoints so the key can be pasted / rotated / cleared without a redeploy. Document the env fallback in `apps/api/.env.example`.

**Layer**: CORE (port + service + adapter) + Integration (Vercel adapter refactor) + Interface (admin controller) + DX (env doc).

**Non-goals**:
- Multi-provider key management (only `anthropic` is wired today; the union is extensible later).
- Cross-provider pre-staging (writing an `anthropic` key while `OL_AI_PROVIDER=fake` is rejected — see §3 *Behaviour for `OL_AI_PROVIDER=fake`*).
- A new `ai_provider_settings` table — we reuse `integration_credentials` with `ref = ai-provider:{provider}`.
- FE work (tracked separately as #399).

## 2. Codebase research

### Precedent to mirror: webhook secret migration
- Service: `libs/core/src/integrations/application/services/webhook-secret.service.ts`
- Adapter: `libs/core/src/integrations/infrastructure/adapters/credentials-webhook-secret.adapter.ts` — implements a port with `getSecret` / `invalidate`, has a 60 s FIFO cache, and falls back to an env var with a one-shot deprecation warning.
- Storage table: `integration_credentials` (`libs/core/src/integrations/infrastructure/persistence/entities/integration-credential.orm-entity.ts`) — keyed by unique `ref`, JSONB `credentialsJson`, `encrypted: boolean`. The webhook-secret rows store `{ ciphertext: '<aes-gcm>' }`.
- Repo port: `libs/core/src/integrations/domain/ports/integration-credential-repository.port.ts` — exposes `getByRef` / `create` / `update` / `delete`. Throws `CredentialNotFoundException` on miss.
- Crypto: `libs/shared/src/crypto/crypto.service.ts` — `encrypt(plaintext)` / `decrypt(ciphertext)`, AES-256-GCM keyed off `OPENLINKER_CREDENTIALS_ENCRYPTION_KEY`.
- DI tokens: `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN` exported from `libs/core/src/integrations/integrations.tokens.ts` and re-exported from `@openlinker/core/integrations`.
- Controller pattern (rotate webhook secret): `apps/api/src/integrations/http/connection.controller.ts:202-218` — `@Roles('admin')`, `Cache-Control: no-store`. Top-level resource path (`/connections`), no domain prefix — same convention used by `PromptTemplatesController` (`@Controller('prompt-templates')`).

### Today's AI key handling
- `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.ts` imports `{ anthropic } from '@ai-sdk/anthropic'` (the default singleton, which reads `process.env.ANTHROPIC_API_KEY`). The package also exports `createAnthropic({ apiKey })` (`AnthropicProviderSettings.apiKey`, confirmed in the SDK's `dist/index.d.ts:1084`). We will switch to `createAnthropic`.
- `AiIntegrationModule.register()` (`libs/integrations/ai/src/ai-integration.module.ts`) selects between `VercelAiCompletionAdapter` and `FakeAiCompletionAdapter` based on `OL_AI_PROVIDER` (default `anthropic`). It already imports `ConfigModule` and exports `AI_COMPLETION_PORT_TOKEN`.
- The completion port is consumed from `apps/api` only (`libs/core/src/content/application/services/content-suggestion.service.ts`), and `AiIntegrationModule` is registered exactly once inside `apps/api/src/integrations/integrations.module.ts:33`. There is no `apps/worker` consumer — single place to wire.
- `apps/api/.env.example` does not mention `ANTHROPIC_API_KEY` at all today.

### Decision: where the port + service live
- The port is part of the AI bounded context (it knows about `AiProvider`), so it lives in `libs/core/src/ai/domain/ports/`.
- The settings service belongs to the same context; it depends on both the credentials port (read) and the credential repository port (write).
- **Service interface co-located with implementation** under `libs/core/src/ai/application/services/`, mirroring the existing `prompt-template.service.interface.ts` next to `prompt-template.service.ts` in this same module. (`engineering-standards.md` documents `application/interfaces/` as the default; this AI module already deviates and we keep the deviation local rather than introducing a third pattern. The `PromptTemplateService` setup is treated as the local convention for `libs/core/src/ai/`.)
- Wiring goes into `AiIntegrationModule.register()` (the only place that boots adapter selection), not into the core `AiModule` — this keeps the core module free of the integrations-tokens dependency. `AiIntegrationModule` already imports `ConfigModule`; we add `CoreIntegrationsModule` to its imports so it can resolve `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN`. The new tokens are exported from `@openlinker/integrations-ai` and consumed by the admin controller through the existing re-export chain (`apps/api/src/integrations/integrations.module.ts:42-45`).

## 3. Design

### Single response shape
```ts
// libs/core/src/ai/domain/types/ai-provider-credentials.types.ts
export const AiProviderKeySourceValues = ['db', 'env', 'none'] as const;
export type AiProviderKeySource = (typeof AiProviderKeySourceValues)[number];

/**
 * Single response shape used by both the port (`describe()`) and the
 * service (`get()`). The service adds nothing the port doesn't already
 * compute — keeping one type avoids duplication and drifting Swagger /
 * TanStack Query types.
 */
export interface AiProviderSettingsView {
  /** Active provider read from `OL_AI_PROVIDER` (default: `anthropic`). */
  provider: AiProvider;
  /** True when an API key is currently resolvable for the active provider. */
  configured: boolean;
  /** Where the key currently resolves from. `'none'` ⇒ neither DB nor env. */
  source: AiProviderKeySource;
}
```

### Port (read side)
```ts
// libs/core/src/ai/domain/ports/ai-provider-credentials.port.ts
export interface AiProviderCredentialsPort {
  /**
   * Resolve the API key for the active provider.
   *
   * Resolution order (DB wins over env when both are set):
   *   1. Encrypted row in `integration_credentials` at `ref = ai-provider:{provider}`
   *   2. `ConfigService.get('ANTHROPIC_API_KEY')` (legacy fallback for local dev)
   *   3. throws `AiProviderKeyMissingError` if neither is set
   *
   * Should never be called for `provider=fake` — `FakeAiCompletionAdapter`
   * does not invoke the port. Throws if it is called in that mode.
   */
  getApiKey(): Promise<string>;

  /** Where the key currently resolves from, without exposing the value. */
  describe(): Promise<AiProviderSettingsView>;

  /** Drop the cached value (called by the settings service after PUT/DELETE). */
  invalidate(): void;
}
```

The "active provider" is read once at adapter construction from `OL_AI_PROVIDER` (default `anthropic`). The port is provider-agnostic in shape; what it does internally varies by provider. For the singleton-per-deployment model in this issue, no `provider` argument is needed.

### Settings service (write side)
```ts
// libs/core/src/ai/application/services/ai-provider-settings.service.interface.ts
//   (co-located with the implementation, matching prompt-template.service.interface.ts)
export interface IAiProviderSettingsService {
  get(): Promise<AiProviderSettingsView>;
  set(apiKey: string, actorUserId?: string): Promise<void>;
  clear(actorUserId?: string): Promise<void>;
}
```

`set` upserts `integration_credentials` at `ref = ai-provider:{provider}` with `{ ciphertext: encrypt(apiKey) }`, `encrypted: true`. `clear` deletes the row. Both call `port.invalidate()` so the next request re-reads.

### Behaviour for `OL_AI_PROVIDER=fake`
The admin endpoints stay registered in DI in fake mode (so the FE doesn't 404), but they enforce that fake doesn't accept keys:

| Endpoint | `provider=anthropic` | `provider=fake` |
|---|---|---|
| `GET` | `{ provider, configured, source }` per resolution | `{ provider: 'fake', configured: false, source: 'none' }` |
| `PUT` | upsert + 204 | `400 Bad Request` — *"Active provider 'fake' does not require an API key."* |
| `DELETE` | delete + 204 | `400 Bad Request` — same message |

This avoids the cross-provider pre-staging complexity (writing an `anthropic` row while `OL_AI_PROVIDER=fake`) while keeping the FE story uniform: it always GETs the same shape and the controller refuses writes when irrelevant. Pre-staging is explicitly out of scope (see §1 *Non-goals*).

### Adapter (DB + env fallback)
```ts
// libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts
@Injectable()
export class CredentialsAiProviderAdapter implements AiProviderCredentialsPort {
  // Mirrors CredentialsWebhookSecretAdapter:
  //   - 60s FIFO cache (single entry — there's one provider)
  //   - getApiKey: DB hit (decrypt) → env (warn once) → throw
  //   - describe: returns 'db' | 'env' | 'none' without revealing the key
  //   - invalidate: clear cache
}
```

Env-fallback variable name: `ANTHROPIC_API_KEY`, **read via `ConfigService.get<string>('ANTHROPIC_API_KEY')`** — matching `CredentialsWebhookSecretAdapter` (which goes through `ConfigService.get<string>(...)` at `credentials-webhook-secret.adapter.ts:108-111`). No raw `process.env` access.

### Vercel adapter refactor
Replace the implicit `anthropic(model)` call with:
```ts
import { createAnthropic } from '@ai-sdk/anthropic';
// ...
const apiKey = await this.credentials.getApiKey();
const provider = createAnthropic({ apiKey });
const result = await this.generateTextFn({ model: provider(model), ... });
```
Constructor gains an `AiProviderCredentialsPort` injection. The existing `VERCEL_GENERATE_TEXT_FN_TOKEN` override stays for tests; the new spec adds a stub `AiProviderCredentialsPort`.

### HTTP surface
```
GET    /ai-provider-settings                 → 200 { provider, configured, source }
PUT    /ai-provider-settings   body{apiKey}  → 204
DELETE /ai-provider-settings                 → 204
```
Path is `@Controller('ai-provider-settings')` — single, top-level resource path matching the BE convention used by `@Controller('prompt-templates')` and `@Controller('connections')`. The FE issue (#399) keeps `/ai/provider-settings` on the *frontend* route side (mirrors how prompt-templates work today: BE at `/prompt-templates`, FE at `/ai/prompt-templates`).

Admin-only (`@Roles('admin')`), `Cache-Control: no-store` on all three. Response body is an `AiProviderSettingsResponseDto` with **only** `provider`, `configured`, `source` properties — no `apiKey` field exists on the DTO at all (Swagger generation will reflect that).

### Logging contract
Service logs follow the structured shape established by the webhook-secret service:

```ts
this.logger.log('ai_provider_settings.set', { provider, actor: actorUserId ?? 'system' });
this.logger.log('ai_provider_settings.clear', { provider, actor: actorUserId ?? 'system' });
```

Matches `this.logger.log('webhook_secret.rotated', { ... })` at `webhook-secret.service.ts:74`. Never log the key value.

### Migration?
None. The `integration_credentials` table already exists and is generic enough; we just write rows with a new `ref` discriminator. `migration:show` will be checked as a sanity step in the quality gate.

## 4. Step-by-step

| # | File | What | AC |
|---|---|---|---|
| 1 | `libs/core/src/ai/domain/types/ai-provider-credentials.types.ts` (new) | Define `AiProviderKeySourceValues` (`as const`) + `AiProviderKeySource` + `AiProviderSettingsView` (single response shape used by port + service). | No runtime artifact beyond the values array. |
| 2 | `libs/core/src/ai/domain/exceptions/ai-provider-key-missing.exception.ts` (new) | Domain exception thrown by `getApiKey()` when neither DB nor env has a key. | Lives in `domain/exceptions/`, no framework imports. |
| 3 | `libs/core/src/ai/domain/ports/ai-provider-credentials.port.ts` (new) | Port interface. | No NestJS / TypeORM imports. |
| 4 | `libs/core/src/ai/ai.tokens.ts` | Add `AI_PROVIDER_CREDENTIALS_PORT_TOKEN` and `AI_PROVIDER_SETTINGS_SERVICE_TOKEN`. | Tokens re-exported from `@openlinker/core/ai`. |
| 5 | `libs/core/src/ai/application/services/ai-provider-settings.service.interface.ts` (new) | `IAiProviderSettingsService` interface — **co-located** with the implementation, matching the `prompt-template.service.interface.ts` placement in the same directory. | Service-interface naming convention. |
| 6 | `libs/core/src/ai/application/services/ai-provider-settings.service.ts` (new) | Implementation. Depends on `AiProviderCredentialsPort`, `IntegrationCredentialRepositoryPort`, `CryptoService`, `ConfigService` (for active provider name). Rejects writes when `provider=fake` with a 400. Logs `ai_provider_settings.set/clear` with structured `{ provider, actor }`. | Calls `port.invalidate()` after every write; never logs the key. |
| 7 | `libs/core/src/ai/application/services/ai-provider-settings.service.spec.ts` (new) | Unit tests: get-when-db, get-when-env, get-when-none, set creates row, set updates row, clear deletes row, every write invalidates, set/clear throw on `provider=fake`, logger receives structured event. | Mocks all ports — never touches a real DB. |
| 8 | `libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.ts` (new) | Port impl: 60 s FIFO cache, DB → env → throw resolution, one-shot env-fallback warning. Env reads go through `ConfigService.get<string>('ANTHROPIC_API_KEY')`, never `process.env`. For `provider=fake`, `describe()` returns `{ provider: 'fake', configured: false, source: 'none' }` without any DB/env lookup, and `getApiKey()` throws (should never be called). | `getApiKey` short-circuits the cache; `describe` does not. |
| 9 | `libs/core/src/ai/infrastructure/adapters/credentials-ai-provider.adapter.spec.ts` (new) | Unit tests: DB hit, DB row missing → env fallback warns once, both missing → throws `AiProviderKeyMissingError`, cache hit, invalidate clears cache, `provider=fake` short-circuit, env reads happen via `ConfigService` (not `process.env`). | Mocks repo + crypto + config. |
| 10 | `libs/core/src/ai/index.ts` | Re-export the new port, types, exception, service interface, and tokens. | Public surface stays consistent. |
| 11 | `libs/integrations/ai/src/ai-integration.module.ts` | Add `CoreIntegrationsModule` to `imports` (for `INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN`) + `CryptoService` to providers. **Wire `CredentialsAiProviderAdapter` and `AiProviderSettingsService` regardless of the selected provider** so the admin endpoints work in both `anthropic` and `fake` modes. Export the two new tokens. | `OL_AI_PROVIDER=fake` boots without a DB / env key; admin GET still returns 200, PUT/DELETE return 400. |
| 12 | `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.ts` | Switch to `createAnthropic({ apiKey })`. Inject `AiProviderCredentialsPort`. Resolve key on every `complete()` call (cache lives in the port adapter — good enough). | All existing spec assertions still pass; new spec asserts the resolved key reaches `createAnthropic`. |
| 13 | `libs/integrations/ai/src/infrastructure/adapters/vercel-ai-completion.adapter.spec.ts` | Add a stub `AiProviderCredentialsPort` to the constructor and a single new test that captures the SDK call site to confirm the key flows through. | All previous tests still green. |
| 14 | `apps/api/src/ai/http/dto/update-ai-provider-settings.dto.ts` (new) | `class-validator`: `@IsString @IsNotEmpty @MinLength(8) @MaxLength(512) apiKey`. Length bounds only — no `sk-ant-` prefix check (Anthropic prefixes have changed before). | Rejects empty / whitespace strings. |
| 15 | `apps/api/src/ai/http/dto/ai-provider-settings-response.dto.ts` (new) | Response shape with `@ApiProperty` on `provider`, `configured`, `source` only. The DTO type structurally cannot carry an `apiKey` field — Swagger output will reflect that. | No `apiKey` property exists on the class. |
| 16 | `apps/api/src/ai/http/ai-provider-settings.controller.ts` (new) | `@Controller('ai-provider-settings')` — three endpoints: GET / PUT (HttpCode 204) / DELETE (HttpCode 204). All `@Roles('admin')`. `Cache-Control: no-store`. Accepts `@CurrentUser()` for actor logging. PUT/DELETE return 400 when active provider is `fake`. | Returns 204 on success; payload never contains key; non-admin → 403. |
| 17 | `apps/api/src/ai/ai.module.ts` | Register `AiProviderSettingsController`. Import `IntegrationsModule` (apps/api one — already re-exports `AiIntegrationModule`) so the service token is resolvable. Same pattern as `apps/api/src/content/content.module.ts:34`. | DI compiles at boot. |
| 18 | `apps/api/test/integration/ai-provider-settings.int-spec.ts` (new) | Integration test against the real Postgres harness (`docs/testing-guide.md#integration-tests`). Covers: PUT writes encrypted row, GET returns `source=db` after PUT, GET returns `source=env` when only env is set, GET returns `source=none` on a clean slate, DELETE clears the row and the next GET returns `source=env` (or `none`). One round-trip asserts `decrypt(stored.ciphertext) === originalKey`. | Real `integration_credentials` table; no mocks except outbound HTTP. |
| 19 | `apps/api/test/integration/content-editor-and-suggest.int-spec.ts` | Verify still passes after the Vercel adapter constructor change (the test runs with `OL_AI_PROVIDER=fake` so `FakeAiCompletionAdapter` is selected and the new port wiring is unused on the hot path; this is a sanity check, not a behaviour change). | Test suite green. |
| 20 | `apps/api/.env.example` | Add a `# --- AI provider --------------------` block. Documents `OL_AI_PROVIDER` and `ANTHROPIC_API_KEY` (marked as a dev-only fallback that the admin UI overrides — mirrors the webhook-secret deprecation note at lines 58–64). | Documented end-to-end. |

## 5. Risks / open questions

- **Resolution timing**: Resolving the API key on every `complete()` call adds one async lookup per LLM request, but the cache is in-memory and 60 s TTL — measured cost is negligible compared to the LLM round-trip itself. Confirmed by webhook-secret precedent which does the same on every webhook.
- **`OL_AI_PROVIDER=fake`**: `FakeAiCompletionAdapter` never calls `port.getApiKey()`. The port + service + admin controller are wired regardless of provider so the FE doesn't 404 on `/ai-provider-settings` in fake mode; PUT/DELETE refuse with 400 to make the "fake doesn't need a key" semantics explicit. Cross-provider pre-staging is intentionally out of scope.
- **Resolution priority**: DB always wins over env, even when both are set. Documented on the port and surfaced in the response (`source` reflects the *effective* origin, not the *available* origins). The FE will surface "key currently set via env, save here to override" only when `source === 'env'`.
- **Key shape validation**: We deliberately do *not* validate that `apiKey` starts with `sk-ant-` — Anthropic's prefix has changed before, and a brittle prefix check would break next time. Length bounds (`8..512`) + non-empty are enough.
- **Concurrent writes**: Two admins hitting PUT at once would race; last-write-wins via `update`-then-`create`-on-miss matches the webhook-secret pattern. Acceptable for an admin endpoint with low concurrency.
- **Telemetry**: Service logs `ai_provider_settings.set` / `.clear` with structured `{ actor, provider }` (no key value). Aligns with `webhook_secret.rotated`.

## 6. Quality gate

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm test:integration              # new ai-provider-settings.int-spec.ts must pass
pnpm --filter @openlinker/api migration:show   # confirms zero new migrations needed
```

All must pass with zero errors before commit.
