# Implementation Plan — #859 Neutral OAuth-completion port (relocate Allegro OAuth into the plugin)

**Issue:** #859 · **Modularity epic:** #546 · **Pattern precedent:** #583 (webhook-provisioning port/registry)
**Layer:** CORE (new port + registry) + Integration (Allegro impl) + Interface (host orchestration + thin controller)
**Branch:** `859-allegro-oauth-port-relocation` · **ADR:** yes (new port → plugin-contract change)

> Behaviour-preserving refactor. The HTTP contract (`POST /integrations/allegro/oauth/connect`, `GET …/callback`) and the FE are **untouched**. Design settled via `/grill-me` (Q1–Q5) — decisions + rationale inline.

## 1. Goal & non-goals

Move Allegro-specific OAuth knowledge out of the host's `AllegroOAuthService` into the Allegro plugin behind a neutral, registry-dispatched **`OAuthCompletionPort`**, so `apps/api` orchestrates OAuth platform-neutrally (Redis state/CSRF/idempotency, credential + connection persistence, the same-account guard) and never touches Allegro host URLs, `/auth/oauth/token`, or `/me`.

**Non-goals:** any behaviour change; any FE change (routes/shapes stay); a generic `/integrations/:platform/oauth/*` route; runtime token-refresh (already plugin-owned via `AllegroTokenRefreshService`); `validateConnection` (Q4 — left as-is, overlaps #587, separate cleanup). **Delete** the host's dead `refreshToken` (0 callers).

## 2. Decisions locked (grill Q1–Q5)

- **Q1 — account-id storage:** neutral **`config.oauthAccountId`** (jsonb) written by the neutral orchestration, with **read-fallback to `config.sellerId`** for #820-era connections (backfilled on next re-auth). The non-whitelisting Allegro config validator tolerates the adjacent key by design — no DTO change, no migration. First-class `connections.external_account_id` column (Opt 2) **deferred** (disproportionate `Connection`-aggregate churn for one OAuth platform).
- **Q2 — port surface:** **3-method split** (protocol-honest, optional identity, reusable, matches #820's standalone reader). Interface lives in `oauth-completion.port.ts`; **all types in a sibling `oauth-completion.types.ts`** (mirrors `webhook-provisioning.port.ts` + `webhook-provisioning.types.ts`; engineering-standards §"Type Definitions in Separate Files"):
  ```ts
  interface OAuthCompletionPort {
    buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string;            // sync; pure URL
    exchangeCode(input: ExchangeCodeInput): Promise<OAuthCredentialBlob>;        // normalized, persisted-as-is
    fetchAccountIdentity(input: FetchAccountIdentityInput): Promise<OAuthAccountIdentity | undefined>;
  }
  // OAuthAccountIdentity     = { accountId: string; label?: string }
  // OAuthCredentialBlob      = Record<string, unknown>  — opaque to the host; see contract below
  // FetchAccountIdentityInput = { credentials: OAuthCredentialBlob; config?: Record<string, unknown> }
  // BuildAuthorizationUrlInput / ExchangeCodeInput also carry `config?: Record<string, unknown>`
  ```
  - **Implementation refinement (vs the grill's `fetchAccountIdentity(credentials)`):** all three methods receive the opaque platform-`config` seed. Allegro's `/me` base URL is environment-dependent and `environment` lives in `config`, **not** in the credential blob — so `fetchAccountIdentity` takes `{ credentials, config }`. The locked intent (optional identity, opaque credentials) is preserved; the host just forwards the same opaque `config` it already passes to the other two methods.
  - **Error-code preservation (one new neutral core exception):** to keep the token-exchange **400-vs-500** distinction across the now-neutral boundary, `exchangeCode` throws a neutral **`OAuthCodeExchangeException`** (`libs/core/src/integrations/domain/exceptions/`) on a non-OK provider token response; the host maps it to `BadRequestException` (400). Network/timeout (plugin's own `AllegroNetworkException`) and any `fetchAccountIdentity` failure propagate to the host's catch-all → `InternalServerErrorException` (500) — byte-identical to today. The plugin never imports `@nestjs/common`.
  - **`exchangeCode` blob contract (behaviour-preservation hinge):** the returned `OAuthCredentialBlob` is the **normalized** shape the host persists verbatim — `{ accessToken, refreshToken, expiresAt, clientId, clientSecret }` (today built in `storeCredentialsAndCreateConnection`, `allegro-oauth.service.ts:341-350`). It is **not** the raw Allegro token response. The runtime `AllegroTokenRefreshService` reads these exact keys back, and **no int-spec here exercises that downstream read** — so the adapter folds `clientId`/`clientSecret` (from `ExchangeCodeInput`) into the blob, and the adapter spec asserts the blob has exactly those five keys. `fetchAccountIdentity` reads `credentials.accessToken` (normalized), not `access_token`.
  - **`fetchAccountIdentity` failure contract (preserves #820):** **throws** on any transport/`/me` failure (adapter wraps `AllegroAccountReader`'s exceptions) → completion hard-fails (InternalServerError, state left uncompleted → retryable). Returns `undefined` **only** when the platform has no account-identity concept. Documented on the port method — it's the correctness hinge for the same-account guard.
- **Q3 — tests:** the fuller hermetic pyramid — (i) **neutral-service int-spec** with a `FakeOAuthCompletionAdapter` (real Redis+DB) covering persist/idempotency/#819/#820/optional-identity; (ii) **HTTP-through-`AllegroController` int-spec** with the real Allegro provider, Allegro token + `/me` **network-stubbed** (route→controller→registry→adapter→shapes); re-home + augment the 29 existing unit tests by responsibility; app-boot int-spec keeps verifying DI.
- **Q4 — scope edges:** neutralize the mismatch code `ALLEGRO_SELLER_MISMATCH` → **`OAUTH_ACCOUNT_MISMATCH`** (verified zero consumers); neutralize `credentialsRef` prefix `allegro_{env}_…` → **`oauth_{adapterKey}_…`** (cosmetic-for-new-refs only: credentials resolve by the exact `db:`-prefixed ref, nothing parses the human-readable prefix, and existing connections keep their stored ref); leave `validateConnection`; neutral naming **`OAuthConnectionService`** / `OAUTH_CONNECTION_SERVICE_TOKEN` / `IOAuthConnectionService`; `AllegroController` + routes stay (generic `/integrations/:platform/oauth/*` is the *next* thing this seam unlocks — noted in the ADR so the half-neutral state reads as deliberate).
- **Q5 — registry/ADR/state:** new **`OAuthCompletionRegistryService`** (core integrations infra) + **11th `HostServices` registry** `oauthCompletionRegistry`; **ADR** (next free number, ~ADR-012) recording the decision + rejected alternatives; **neutral `OAuthStateData`** carries `initialConfig?: Record<string,unknown>` (Allegro controller fills `{ environment, masterCatalogConnectionId? }`) instead of named Allegro fields.

## 3. Neutral / Allegro split (verified)

| Stays neutral (host orchestration) | Moves into the plugin (behind the port) |
|---|---|
| Redis OAuth-state lifecycle (`validateState`, write, `markStateCompleted`, `checkCompletedState`) | env→host mapping (`getApiBaseUrl`) |
| credential-blob persistence + connection create/re-auth (#819) | authorize-URL construction (`/auth/oauth/authorize`) |
| same-account guard (#820), now keyed on neutral `oauthAccountId` | token exchange (`POST /auth/oauth/token`, Basic auth, `AllegroOAuthTokenResponse`) |
| `OAuthStateData` / `CompletedStateData` / authorization-response (neutral) + the exchange→identity sequencing | `/me` read (`AllegroAccountReader`, already plugin-side from #820); `fetchWithTimeout`/`formatFetchError` (move with the calls) |

Delete: host `refreshToken`; host-local `AllegroOAuthTokenResponse` (becomes plugin-internal).

## 4. Step-by-step (one cohesive PR — port + relocation + rewire must land together)

| # | File | Change |
|---|---|---|
| 1 | `libs/core/src/integrations/domain/ports/oauth-completion.port.ts` (NEW, interface-only) + `domain/types/oauth-completion.types.ts` (NEW) | `OAuthCompletionPort` (3 methods, doc the two contracts above); types: `BuildAuthorizationUrlInput`, `ExchangeCodeInput`, `OAuthAccountIdentity`, `OAuthCredentialBlob` |
| 2 | `libs/core/src/integrations/infrastructure/adapters/oauth-completion-registry.service.ts` (NEW) + `__tests__/` spec + token in `integrations.tokens.ts` + barrel + module wiring | registry mirroring `WebhookProvisioningRegistryService`; token `INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN = Symbol('OAuthCompletionRegistryService')` in `integrations.tokens.ts` (surfaced via sub-barrel `export *`, #595) |
| 3 | `libs/plugin-sdk/src/host-services.ts` | add `oauthCompletionRegistry` (11th registry) |
| 4 | `libs/integrations/allegro/src/infrastructure/.../allegro-oauth-completion.adapter.ts` (NEW) + spec | implement port; relocate `getApiBaseUrl`/authorize/token-exchange/`fetchWithTimeout`; `fetchAccountIdentity` delegates to `AllegroAccountReader`; `AllegroOAuthTokenResponse` becomes plugin-internal |
| 5 | `libs/integrations/allegro/src/allegro-plugin.ts` + `allegro-integration.module.ts` | self-register the adapter at `allegro.publicapi.v1` |
| 6 | `apps/api/.../oauth-connection.service.ts` (replaces `allegro-oauth.service.ts`) + spec | neutral orchestration: state lifecycle, registry dispatch, persistence, neutral same-account guard (`oauthAccountId` + `sellerId` fallback), neutral `credentialsRef`; **drop** `refreshToken` |
| 7 | `apps/api/.../interfaces/oauth-connection.service.{interface,types}.ts` | neutral `IOAuthConnectionService`, `OAUTH_CONNECTION_SERVICE_TOKEN`, neutral `OAuthStateData` (`initialConfig`), `CompletedStateData` |
| 8 | `apps/api/.../http/allegro.controller.ts` (+spec) | thin dispatch; routes/response shapes unchanged; supplies adapterKey + `initialConfig` |
| 9 | `apps/api/.../integrations.module.ts` | drop `AllegroOAuthService` + host-side `AllegroAccountReader` providers; provide neutral `OAuthConnectionService` + the registry |
| 10 | `apps/api/test/integration/oauth-connection.int-spec.ts` (NEW) | (i) fake-provider neutral flow + (ii) HTTP-through-`AllegroController` with network-stubbed Allegro |
| 11 | `docs/architecture/adrs/013-neutral-oauth-completion-port.md` (NEW; 012 was taken by branch-1-fulfillment-modeling → 013) + README index | decision + rejected alternatives (Q1 Opt2, Q2 combined, extend-existing-registry); note the deferred generic `/integrations/:platform/oauth/*` route |

## 5. Validation

- **Architecture:** new port in CORE; Allegro impl resolved at runtime via the registry (no core→integration value import); host neutral. No migration (jsonb). ADR for the contract change.
- **Behaviour preservation (the risk):** the callback ordering (`validateState` → idempotent-replay → `exchangeCode` → `fetchAccountIdentity` → guard → persist → `markStateCompleted`), #819 re-auth, and #820 guard-before-rotation must be byte-identical post-split — proven by the re-homed unit tests + the two int-specs. A `fetchAccountIdentity` failure hard-fails completion (InternalServerError; state uncompleted → retryable), exactly as #820 settled.
- **Quality gate:** `pnpm lint && pnpm type-check && pnpm test`; `pnpm test:integration` for the new + app-boot int-specs.
- **AllegroAccountReader (#820)** stays in the plugin and is now consumed by the adapter's `fetchAccountIdentity` (no longer host-injected) — closing the last host→plugin OAuth coupling.
