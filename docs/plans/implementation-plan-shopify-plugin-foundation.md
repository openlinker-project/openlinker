# Implementation Plan: Shopify plugin foundation (#3974)

## 1. Task

Ship `@openlinker/integrations-shopify` as a real plugin package with no capability adapters yet:
connection, credentials (client credentials, pre-issued token, OAuth install), Admin GraphQL client,
config + credentials validation, connection tester, retry and auth-failure classifiers, shop context,
cost-aware pacing, and removal of the minted token when the connection is archived.

Layer: Integration (plugin) + small Interface/SDK additions (OAuth endpoints, an archive hook).

Built fresh on `main`. The prototype branch `3928-shopify-prototype` is a reference only.

### Non-goals

- Capability adapters (ProductMaster, InventoryMaster, OrderSource, ...): follow-up issues. The
  manifest ships `supportedCapabilities: []` (a capability enters with its adapter, the #980 rule).
- Webhook decoder / translator / provisioner, scheduler tasks: they belong to the capabilities.
- Multi-location stock (one Shopify location until a WMS arrives).
- A true cost-aware shared limiter in `libs/shared/rate-limit` (see 3.6).

## 2. Research findings

- Closest pattern: `libs/integrations/shoper` (plugin descriptor, `createNestAdapterModule`, per-host
  shared rate-limit bucket via `resolveRateLimitBucketKey`, tester, validators, classifiers).
- OAuth: core already has a neutral authorization-code flow. `OAuthCompletionPort` +
  `OAuthCompletionRegistryService` (in `HostServices.oauthCompletionRegistry`) and
  `IOAuthConnectionService` in `apps/api`. Allegro registers an adapter and has its own
  `AllegroController` (`integrations/allegro/oauth/connect|callback`).
- Token refresh precedent: `AllegroTokenRefreshService` writes rotated tokens back through
  `ICredentialsService` (`CREDENTIALS_SERVICE_TOKEN`), injected in the plugin's Nest module, with a
  Redis lock.
- Archive: `ConnectionService.archive` (apps/api) deletes the credential row and evicts the HTTP
  transport, but has no plugin hook. K05 showed the minted token stays in Redis ~24 h.
- Shared limiter is request-count based only (`requestsPerMinute`, `maxConcurrent`). No cost.
- Dockerfile: root `Dockerfile` lists every integration package in three places (lines ~42, ~98, ~140).

### Shopify API, confirmed against shopify.dev (2026-10)

- Authorization-code grant: `https://{shop}/admin/oauth/authorize?client_id&scope&redirect_uri&state`;
  callback carries `code`, `hmac`, `shop`, `state`, `timestamp`. HMAC = HMAC-SHA256 over the sorted
  query without `hmac`, keyed by the client secret; `shop` must match
  `^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$`.
- Token exchange: `POST https://{shop}/admin/oauth/access_token` (form) with `client_id`,
  `client_secret`, `code`, **`expiring=1`**. Response: `access_token`, `scope`, `expires_in`,
  `refresh_token`, `refresh_token_expires_in` (90 days).
- **Change from the prototype / spike**: new public apps must use EXPIRING offline tokens. Refresh is
  `grant_type=refresh_token` and ROTATES the refresh token, so it must be written back to the stored
  credentials (the prototype never had OAuth).
- Client-credentials grant (same org, L-C1): unchanged from the prototype.

## 3. Design

### 3.1 Package layout (`libs/integrations/shopify`)

```
package.json, tsconfig.json, tsconfig.spec.json, jest.config.mjs, README.md
src/index.ts
src/shopify.constants.ts           adapter key, platform type, SUPPORTED_API_VERSIONS, scopes, default rate limit
src/shopify-plugin.ts              manifest (supportedCapabilities: []) + register(host)
src/shopify-integration.module.ts  createNestAdapterModule + Nest-only pieces (credentials writer)
src/application/shopify-adapter.factory.ts (+ interface)  builds ONE client per resolution; empty bag for now
src/domain/types/{shopify-config,shopify-credentials,shopify-api}.types.ts
src/domain/policies/shopify-config.policy.ts      parse/normalise config (one parser for all callers)
src/domain/policies/shopify-gid.policy.ts
src/domain/policies/shopify-token-cache-key.policy.ts  one key builder used by the provider AND the archive hook
src/domain/policies/shopify-oauth-hmac.policy.ts  callback HMAC check (pure)
src/domain/exceptions/{api,graphql,network,config,user-errors}.ts
src/infrastructure/http/shopify-response-body.ts
src/infrastructure/http/shopify-access-token.provider.ts   stored token | client credentials | OAuth refresh
src/infrastructure/http/shopify-graphql-client.ts           + cost-aware throttle memo
src/infrastructure/http/shopify-client.builder.ts
src/infrastructure/shop-context/shopify-shop-context.provider.ts
src/infrastructure/adapters/shopify-connection-tester.adapter.ts
src/infrastructure/adapters/shopify-connection-{config,credentials}-shape-validator.adapter.ts
src/infrastructure/adapters/shopify-auth-failure-classifier.adapter.ts
src/infrastructure/adapters/shopify-retry-classifier.adapter.ts
src/infrastructure/adapters/shopify-oauth-completion.adapter.ts
src/infrastructure/adapters/shopify-connection-archive-hook.adapter.ts
```

Exceptions only used by capability adapters (not-mapped, variant-required, ...) are NOT copied now;
the retry classifier gets them with their adapters.

### 3.2 Credentials (three modes)

`ShopifyCredentials`:
- `{ accessToken }` - pre-issued token, used as is, never renewed.
- `{ clientId, clientSecret }` - client-credentials grant, minted token cached (host cache + per-process
  memo), re-minted once on 401.
- `{ clientId, clientSecret, accessToken, refreshToken, expiresAt, refreshTokenExpiresAt, grant: 'oauth' }`
  - written by the OAuth completion adapter. Refreshed before `expiresAt`; the rotated pair is persisted
  through `ICredentialsService.update` under a Redis-cache lock (Allegro precedent), injected by the
  Nest module into the plugin factory as a `ShopifyCredentialsWriter` closure.

Credentials shape validator: accessToken, or clientId + clientSecret (OAuth blob satisfies both).

### 3.3 Config + validation (K06)

`storeDomain` (`*.myshopify.com`), `apiVersion` (member of `SHOPIFY_SUPPORTED_API_VERSIONS`, default
`2026-10`), `locationId` (numeric id or Location GID), optional `unmanagedStockQuantity`
(non-negative integer). Shape validator names the field.

Location EXISTENCE needs credentials and an API call, which the config shape validator does not have.
It is checked by the connection tester (and by the shop-context provider at runtime), with
`locationId` named in the message. See open question Q1.

### 3.4 Connection tester (K02, K03, G03)

Query `shop { name currencyCode taxesIncluded }`, `currentAppInstallation { accessScopes }`, and the
configured location (`location(id:)`) or the primary one. Success message: shop name, currency,
taxesIncluded, location name. Distinct failures, mapped from the token grant's error body:
- `app_not_installed` -> "the app is not installed on this store; install it from the Dev Dashboard".
- `shop_not_permitted` (another organization) -> "client credentials only work for stores in the app's
  organization; connect this store with OAuth".
- `invalid_client` / wrong secret -> check client id and secret.
- unknown location -> names `locationId`; missing scopes -> lists them.
The grant error code is parsed into `ShopifyApiError.grantError` so the tester and the auth-failure
classifier read a field, not a message.

### 3.5 Classifiers

- Auth failure -> `needs_reauth`: 401 after the one inline re-mint/refresh, "Invalid API key or access
  token", grant refused with `invalid_client`, an OAuth refresh refused (`invalid_grant`).
  NOT: `ACCESS_DENIED` (scope), `app_not_installed`/`shop_not_permitted` (config, non-retryable).
- Retry: defer `THROTTLED`, the `orderCreate` "Too many attempts" user error (L-X1), 429, 503;
  retryable `CHANGE_FROM_QUANTITY_STALE` and `ShopifyNetworkError` (G07); non-retryable config
  exception, `ACCESS_DENIED`, other user errors, other 4xx.

### 3.6 Rate limiting (L-C2)

- Shopify meters cost per app per store, so connections to one store share ONE bucket:
  `resolveRateLimitBucketKey` -> `shopify:store:{storeDomain}` (Shoper's ADR-038 amendment shape).
- Request-count guard `SHOPIFY_DEFAULT_RATE_LIMIT` (240/min, 4 concurrent) through the shared limiter.
- Cost: the client records the last `throttleStatus` per store (process memo) and waits before a call
  when the bucket is below the expected cost; a `THROTTLED` answer with a short wait is retried once
  inline, longer waits are deferred by the classifier. Budget is never hard-coded.
- A cost-aware mode of the shared limiter is NOT built here (follow-up issue to file).

### 3.7 OAuth install (K03)

- `ShopifyOAuthCompletionAdapter` registered in `host.oauthCompletionRegistry`:
  `buildAuthorizationUrl` (shop from the `config` seed, scopes from `SHOPIFY_REQUIRED_SCOPES`),
  `exchangeCode` (`expiring=1`, checks granted scopes), `fetchAccountIdentity` (`shop { id myshopifyDomain }`
  -> accountId = shop GID, guards re-auth against a different store).
- `apps/api`: `ShopifyController` at `integrations/shopify/oauth/connect` (admin) and
  `integrations/shopify/oauth/callback` (`@Public`, verifies `hmac` and `shop` before using the code),
  mirroring `AllegroController` and the neutral `IOAuthConnectionService`.
- Web: `plugins/shopify` (setup card, two routes, API namespace) + `features/shopify` (API, hooks, setup
  form) + `pages/connections/shopify-setup-page.tsx` and `pages/integrations/shopify-connect-callback-page.tsx`
  (plugins may not use `useApiClient`). Copy in the core `shopify` namespace (en + pl). The callback is a
  POST of the raw redirect query, because the `hmac` covers every parameter and the global
  `forbidNonWhitelisted` pipe would refuse unknown ones.

### 3.8 Archive removes the cached token (K05)

New neutral port `ConnectionArchiveHookPort { onArchived(connection): Promise<void> }` +
`ConnectionArchiveHookRegistryService` in `libs/core/src/integrations`. NOT added to `HostServices`
(that would touch every hand-written plugin module and the `host-services-not-widened` guard); the
Shopify Nest module registers its hook directly on the registry token, the webhook-provisioner pattern. `ConnectionService.archive`
calls the hook after the row is archived, best effort (logged, never fails the archive). Shopify's hook
deletes the token cache keys; the key is `shopify:access-token:{connectionId}` with the credential
fingerprint stored INSIDE the value (so one key per connection and a rotated secret still never reuses
an old token). Justification: same registry pattern as the credentials rewriter; no other way for a
plugin to clean up per-connection state at archive.

### 3.9 Registration

`apps/api/src/plugins.ts`, `apps/worker/src/plugins.ts`, `apps/api/package.json`,
`apps/worker/package.json` deps, tsconfig references, root `Dockerfile` (3 lines).

## 4. Steps

1. Package scaffold + constants + types + policies + exceptions. Tests: config policy (each field,
   unsupported version, location forms), gid, hmac, cache key.
2. HTTP: response body, access-token provider (3 modes, memo/cache, refresh with lock + write-back),
   GraphQL client (auth retry, throttle memo). Tests with a fake `FetchLike`.
3. Shop context provider. Tests: configured / primary / unknown location.
4. Tester, validators, classifiers. Tests per AC case.
5. OAuth completion adapter + api `ShopifyController` (+ DTOs). Tests: adapter, HMAC refusal.
6. Archive hook: core port/registry/token, plugin-sdk wiring, `ConnectionService.archive` call,
   Shopify hook. Tests: connection.service spec (hook called, failure tolerated), hook adapter.
7. Plugin + module + registration + Dockerfile + README.
8. Web plugin (if Q2 = yes) + locales.
9. Docs: architecture-overview § Plugin Manager (Shopify + archive hook), capabilities doc untouched.
10. E2E retest on the dev store (needs `pnpm dev:stack:seed-shopify` from the spike branch and the
    user's stack); results recorded for the PR.

## 5. Validation

- Hexagonal: plugin imports only `@openlinker/core/<ctx>` barrels, `@openlinker/plugin-sdk`,
  `@openlinker/shared/*`. No core domain logic in the plugin. The archive hook is neutral.
- No secrets logged: token, refresh token, client secret never in logs or exception messages.
- Security: OAuth callback verifies state (host), HMAC and shop regex; client follows no redirects.

## Decisions taken (user: "zaczynaj")

- Q1: (a) - location existence is checked by the connection test and the shop-context provider, naming
  `locationId`; format, API version and store domain are refused at save.
- Q2: yes - a minimal web plugin ships in this issue.
- Q3: E2E steps are prepared; the user runs them on their stack.

## Open questions (original)

- Q1 (K06): AC says an unknown location is "refused at save". Save-time validators have no credentials.
  Options: (a) tester + runtime only (the issue text allows "validator or the connection test"),
  (b) add a credential-aware save check in `ConnectionService` (core change). Plan: (a).
- Q2: the issue lists no `apps/web` files, but OAuth needs a callback page. Plan: minimal Shopify web
  plugin in this issue.
- Q3: E2E retest needs the user's stack and a Shopify dev store; I will prepare the steps, the user runs
  or starts the stack.
