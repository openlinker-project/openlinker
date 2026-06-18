# Implementation Plan — Erli connection: API-key auth + config/credentials shape validators + tester (#982)

**Issue:** #982 · **Spec:** #978 · **ADR:** ADR-025 · **Branch:** `982-erli-connection-auth-validators-tester` (stacked on `981-erli-http-client`)
**Layer:** Integration (plugin) + a thin boundary touch (none new — API exception mapping already exists).
**Effort:** M.

---

## 1. Goal (restated)

Make an Erli connection **creatable, validated, and testable** end-to-end:

- An operator pastes an Erli **API key** in OL Admin → connection test passes → connection shows **Active**.
- Invalid/missing key → a clear validation error, no connection created.
- Secrets are never returned in API responses.

Realises **User story 1 (Connect)** from the spec.

### Non-goals

- No capability adapters (offers #984 / orders #993) — `supportedCapabilities` stays `[]`.
- No FE work (#990).
- No migration — reuses the encrypted `integration_credentials` table.
- No capability adapters — the live endpoint set for offers/orders is confirmed against the #992 sandbox spike in #984/#993. The tester's probe (`GET /me`) was itself confirmed by #992 (see Open Question O1, resolved).

---

## 2. Design

Erli is **dependency-light** by ADR-025 (static API key, no OAuth). Mirror the **PrestaShop** patterns (hand-rolled validators, a `ConnectionTesterPort` adapter) rather than Allegro's class-validator DTO + OAuth machinery. **No new package dependency** (no `class-validator`).

All three side-registrations are wired through `createErliPlugin().register(host)` — `createNestAdapterModule` already invokes `plugin.register(host)` in `onModuleInit` (`libs/plugin-sdk/src/create-nest-adapter-module.ts:187`), so **`erli-integration.module.ts` does not change**.

### Connection shape

- **Credentials** (`integration_credentials`, resolved via `host.credentialsResolver.get`): `{ apiKey: string }`.
- **Config** (`connection.config`): `{ baseUrl?: string }` — optional override; defaults to the prod constant `https://erli.pl/svc/shop-api` (already the base URL the #981 client test uses). The sandbox URL (`https://sandbox.erli.dev/svc/shop-api`, confirmed by the #992 spike) drops in via this field with no code change.

### Per-connection client seam — `ErliAdapterFactory`

The #981 HttpClient docblock and interface comment already attribute an **`ErliAdapterFactory` (#982)** as the single place that builds the per-connection `ErliHttpClient`. Introduce it now (lean), so the tester and the future #984/#993 adapters share one credential/baseUrl resolution path:

```
class ErliAdapterFactory {
  async createHttpClient(connection, credentialsResolver, retryOverride?): Promise<IErliHttpClient>
  private async resolveCredentials(connection, credentialsResolver): Promise<ErliCredentials>
  private resolveBaseUrl(connection): string
}
```

- `resolveCredentials` — guards `connection.credentialsRef` present, calls `credentialsResolver.get<ErliCredentials>(ref)`, guards non-empty `apiKey`; on any miss throws `ErliApiException` (the existing exception the client already uses for pre-flight config errors — no new exception type).
- `resolveBaseUrl` — `config.baseUrl` (if a non-empty string) else `ERLI_DEFAULT_BASE_URL`; an override is re-validated against the https + Erli-host allowlist (`isAllowedErliBaseUrl`) and a disallowed value throws `ErliConfigException` (defense-in-depth vs. the create-time validator).
- The tester passes a **no-retry** override (`maxRetries: 0`) so a probe fails fast, matching `AllegroConnectionTesterAdapter`.

> The factory is **not** yet wired into `createCapabilityAdapter` (dispatch table stays empty until #984/#993). It is only the client/credential builder seam this PR's tester needs and the docblocks already promise.

### Files

| # | Path | Purpose |
|---|---|---|
| F1 | `infrastructure/adapters/erli-connection.types.ts` | `ErliCredentials`, `ErliConnectionConfig` interfaces + `ERLI_DEFAULT_BASE_URL` const. |
| F2 | `infrastructure/adapters/erli-connection-credentials-shape-validator.adapter.ts` | `implements ConnectionCredentialsShapeValidatorPort` — require non-empty `apiKey`; throw `InvalidCredentialsShapeException`. |
| F3 | `infrastructure/adapters/erli-connection-config-shape-validator.adapter.ts` | `implements ConnectionConfigShapeValidatorPort` — permissive; if `baseUrl` present it must be a non-empty https URL targeting an Erli-owned host (SSRF allowlist, `domain/policies/erli-base-url.policy.ts`); throw `InvalidConnectionConfigException(pluginName, FlatValidationIssue[])`. |
| F4 | `application/erli-adapter.factory.ts` | `ErliAdapterFactory` (above). |
| F5 | `infrastructure/adapters/erli-connection-tester.adapter.ts` | `implements ConnectionTesterPort` — build client via factory (no-retry), cheap authenticated `GET ERLI_CONNECTION_PROBE_PATH`, map result to `ConnectionTestResult`. |
| F6 | `erli-plugin.ts` (edit) | add `register(host)` registering the two validators + tester at `erliAdapterManifest.adapterKey`. |
| F7 | tests (5) | see §4. |

`index.ts` barrel: **no change** — validators/tester/factory stay package-private (siblings keep theirs private; the public surface is `ErliIntegrationModule` + manifest + typed exceptions).

---

## 3. Cross-context contract compliance

- Imports from `@openlinker/core/integrations` only: `ConnectionConfigShapeValidatorPort`, `ConnectionCredentialsShapeValidatorPort`, `ConnectionTesterPort`, `ConnectionTestResult`, `CredentialsResolverPort`, `InvalidConnectionConfigException`, `InvalidCredentialsShapeException`, `FlatValidationIssue` — all top-level-barrel ports/types/exceptions (allowed shapes).
- `Connection` from `@openlinker/core/identifier-mapping` (entity, allowed).
- `HostServices` / `AdapterPlugin` from `@openlinker/plugin-sdk`.
- `Logger` from `@openlinker/shared/logging`.
- No `orm-entities`, no deep paths, no `any`. Tester catches typed Erli exceptions, never TypeORM errors.

---

## 4. Tests (unit; `pnpm --filter @openlinker/integrations-erli test`)

- **T1** `erli-connection-credentials-shape-validator.adapter.spec.ts` — resolves for `{apiKey:'k'}`; rejects with `InvalidCredentialsShapeException` for missing / empty / non-string `apiKey`.
- **T2** `erli-connection-config-shape-validator.adapter.spec.ts` — resolves for `{}` and an https Erli host; rejects (`InvalidConnectionConfigException`, issues carry `path`/`message`) for non-string / http / malformed / off-host / look-alike-host `baseUrl`. Plus **T2b** `erli-base-url.policy.spec.ts` covering the allowlist helper directly.
- **T3** `erli-adapter.factory.spec.ts` — `createHttpClient` resolves creds + default/override baseUrl, builds a client; throws `ErliApiException` on missing `credentialsRef` / empty `apiKey`. Uses `InMemoryCredentialsResolverAdapter` from `@openlinker/core/integrations/testing`.
- **T4** `erli-connection-tester.adapter.spec.ts` — mock global `fetch`: 2xx → `{success:true, status, latencyMs}`; 401 → `{success:false}` with auth message; network throw → `{success:false}`. Seeds creds via `InMemoryCredentialsResolverAdapter`.
- **T5** `erli-plugin.spec.ts` (edit) — replace the "register is undefined" assertion (lines 64-67) + the bare `host` stub (lines 29-31) with a `makeHostStub()` (jest.fn registries); assert `register(host)` calls all three registries with `erli.shopapi.v1` and an object exposing the right method (`validate` / `test`).

---

## 5. Open questions for the user

- **O1 — probe endpoint (RESOLVED by #992).** The tester needs one cheap authenticated GET. The #992 sandbox spike confirmed `GET /me` ("get my shop") — auth-gated (bad key → 401), no parameters, no side effects — and that the originally-assumed `/offers?limit=1` does not exist (it 404s) on the real API. `ERLI_CONNECTION_PROBE_PATH = '/me'` is the single named constant; unit tests mock `fetch`, so they're endpoint-agnostic.
- **O2 — factory scope.** Build the lean `ErliAdapterFactory` now (honours the #981 docblocks, gives #984/#993 the seam) vs. defer it to #984 and have the tester build its client inline. Plan recommends building it now.
