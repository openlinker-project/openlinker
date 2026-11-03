# Implementation Plan: Shoper — Connection & Auth (#3639)

Epic: #3639 (milestone "Shoper Integration", #5). Evidence base: `docs/plans/analysis/SPIKE-3638-shoper-rest-api.md` (PR #3645, findings C1-C5, C7).

## 1. Understand

**Goal.** A new plugin package `libs/integrations/shoper/` that registers a Shoper adapter (`shoper.restapi.v1`, `platformType: 'shoper'`, `supportedCapabilities: []`), can test a connection against `GET /webapi/rest/application-config`, and rejects malformed credentials / config before persistence.

**Layer.** Integration (infrastructure adapter registration) + Interface (connection config / test via the existing registries). No CORE change.

**Non-goals** (explicit, they belong to later mini-epics of the milestone):
- Any capability port (`ProductMaster` #3640, `InventoryMaster` #3641, `OrderProcessorManager` #3642, fulfilment #3643).
- Webhook provisioning / translators (#3644).
- Retry classifier, rate-limit handling, `defaultRateLimit`. The real ceiling is unconfirmed (spike C6); inventing a number is worse than none. (The auth-failure classifier was originally deferred too, but every sibling plugin ships one, so it is included - see step 5.)
- OAuth2 `authorization_code` flow (spike C2) and any frontend wizard / connection form.
- Scope *enforcement* / diagnostics. "Register scope requirements" is satisfied by an exported constant + README (see step 6).

## 2. Research — what is reused

| Need | Precedent | Decision |
|---|---|---|
| Package skeleton | `pnpm create-adapter shoper` (`scripts/create-adapter.mjs`) | Use the scaffolder, then adapt. |
| Host wiring without plugin-specific Nest providers | `eparagony-integration.module.ts` (`createNestAdapterModule`) | Same. |
| Tester / shape validators | `eparagony-*` and `woocommerce-*` adapters | Same shape, inline checks (no `class-validator` dependency). |
| Outbound transport | `host.http.forConnection(connection)` (`HttpTransportFactoryPort`) | Mandatory; bare `fetch` is lint-banned (#1810). |
| SSRF guard | WooCommerce / Subiekt each carry a 140-line copy of `isUrlSsrfSafe` | **Not copied.** A Shoper shop is always a DNS name, so the validator rejects every IP literal, `localhost` and single-label host outright. Stricter and ~15 lines. |

No existing code mentions `shoper` (grepped `libs`, `apps`, `scripts`, `docs`); no collision.

## 3. Design

**Config** (`Connection.config`): `{ baseUrl: string }`. Accepts a bare host (`xxxxx.shoparena.pl`) or an `https://` URL, normalises to a lowercase host, and rejects: `http://`, any path other than `/`, query/fragment/userinfo, a port, IP literals, `localhost`, hosts with fewer than two labels. The tester builds `https://{host}/webapi/rest/...`.

**Credentials**: `{ token: string }` — the static Bearer token from the shop's "Dodaj integrację" panel (spike C1). `Client ID` is not needed for any request, so it is not stored.

**Connection test.** `GET https://{host}/webapi/rest/application-config` with `Authorization: Bearer`. Result mapping (spike C3, C4):
- `200` → success.
- `401` (`unauthorized_client`) → "token invalid".
- `403` (`insufficient_scope`) → "token valid but lacks scope", with the required-scope list in the message.
- `404` → base URL is not a Shoper shop.
- `5xx` / network / timeout → structured failure, warn-logged.
Never throws. Single attempt (no retries — a retry would mask real latency / auth failures).

**HTTP client.** Minimal `ShoperHttpClient`, constructed per call (holds one connection's token), takes a required `FetchLike`. Per-attempt timeout 15 s, `redirect: 'manual'` and any 3xx is an error (a redirect must not carry the Bearer token to another host), response body capped. Typed errors: `ShoperApiError` (status + parsed `error` / `error_description`), `ShoperNetworkError`. It only has `get` today; later epics extend it.

**Manifest.** `adapterKey: 'shoper.restapi.v1'`, `platformType: 'shoper'`, `supportedCapabilities: []` (a capability name enters the manifest together with the adapter that delivers it — Erli #980 rule), `displayName: 'Shoper REST API'`, `version: '1.0.0'`, `isDefault: true`, **no** `defaultRateLimit`. `createCapabilityAdapter` dispatches an empty table, so asking for any capability fails with the SDK's uniform "does not support capability" error.

**Decisions (resolved against the sibling plugins):**
1. Config key is `baseUrl` (repo convention, cf. WooCommerce `siteUrl`), not `base_url` as written in the issue.
2. `Client ID` is not stored (token only), like the other single-key plugins.
3. An auth-failure classifier is included (`401`/`403` -> `needs_reauth`), as in every sibling plugin.
4. Front-end (setup form / platform picker) is out of scope for this epic - no milestone epic covers it yet.

## 4. Steps

1. **Scaffold** — `pnpm create-adapter shoper`; check the generated package against `eparagony` (`package.json` deps, `tsconfig*.json`, `jest.config.mjs`). Files: `libs/integrations/shoper/*`.
2. **Constants & types** — `src/shoper.constants.ts` (`SHOPER_ADAPTER_KEY`, `SHOPER_PLATFORM_TYPE`, `SHOPER_BRAND`, `SHOPER_API_PATH_PREFIX`, `SHOPER_REQUIRED_SCOPES`), `src/domain/types/shoper-config.types.ts`, `shoper-credentials.types.ts`, `shoper-api.types.ts` (error body).
3. **Base URL policy** — `src/domain/policies/shoper-base-url.policy.ts`: pure `parseShoperBaseUrl(raw): { host } | { issues: string[] }` + `buildShoperApiUrl`. Shared by validator and tester so they cannot disagree.
4. **Exceptions + HTTP client** — `src/domain/exceptions/shoper-api.error.ts`, `shoper-network.error.ts`, `shoper-config.exception.ts`; `src/infrastructure/http/shoper-http-client.ts` (+ `.types.ts`).
5. **Adapters** — `src/infrastructure/adapters/shoper-connection-config-shape-validator.adapter.ts`, `shoper-connection-credentials-shape-validator.adapter.ts`, `shoper-connection-tester.adapter.ts`.
6. **Plugin + module + barrel** — `src/shoper-plugin.ts` (`shoperAdapterManifest`, `createShoperPlugin`; `register(host)` wires tester + two validators), `src/shoper-integration-module.ts` via `createNestAdapterModule`, `src/index.ts`. `README.md`: how to create the token in the panel + the 13 required scopes (produkty, warianty produktów, stany dostępności, kategorie, stawki vat, magazyny, zamówienia, przesyłki, statusy zamówień, klienci, webhooki, dostawy, płatności).
7. **Host wiring** — `tsconfig.base.json` paths; `apps/api` + `apps/worker` `package.json` deps and `src/plugins.ts`; both `test/jest-integration.cjs` mappers (`check-jest-integration-mappers`); `pnpm-lock.yaml` via `pnpm install`; add `libs/integrations/shoper` to `check-outbound-http.mjs` `SCAN_ROOTS` and to the `.eslintrc.js` outbound-transport glob; add the manifest to `master-reservation-writer-absence.spec.ts`.
8. **Tests** (`*.spec.ts`, colocated): base-URL policy (accepted / rejected table), config validator, credentials validator, HTTP client (200, 401, 403, 404, 5xx, 3xx-not-followed, timeout, network, oversize), connection tester (all result mappings, missing credentials, never throws), plugin (manifest values, `register` wires all three, `createCapabilityAdapter` rejects any capability).

## 5. Validation

- **Architecture**: no CORE edit, no cross-plugin import, no `*RepositoryPort` / `*OrmEntity` import; domain layer has no framework imports; imports only through `@openlinker/*` barrels.
- **Naming**: `*.adapter.ts`, `*.exception.ts`, `*.types.ts`, `*.policy.ts` (pure rule, per the `types`/policy convention); `ShoperX` class names.
- **Security**: token never logged and never in an error message; HTTPS-only; SSRF-hardened host; redirects not followed; response size capped; credentials resolved via `credentialsResolver`, not from `config`.
- **Invariants to pass**: `pnpm check:invariants` (workspace deps, outbound-http, jest-integration mappers, create-adapter, cross-context imports), `pnpm lint`, `pnpm type-check`. Unit tests run on CI (per working agreement); I run lint + type-check locally.
- **Live check**: the real-shop connection test (AC 2) is a manual smoke against `sklep729770.shoparena.pl` using the token from the spike; not automated, not committed.

## 6. Acceptance-criteria map

| AC | Covered by |
|---|---|
| Package + manifest registered, `supportedCapabilities: []` | steps 1, 6, 7 |
| Connection test against real shop | step 5 + manual smoke |
| Credentials validator rejects bad token | steps 5, 8 |
| Config validator rejects bad `baseUrl` | steps 3, 5, 8 |
| Unit tests: tester + both validators | step 8 |
| No CORE ↔ Integration violations | step 7 invariants |
