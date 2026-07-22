# Implementation Plan — DPD Polska ConnectionTester (#1732)

## 1. Goal & Classification

Give the DPD Polska adapter (`dpd.polska.rest.v1`) a real "Test connection" probe.
Today the button fails with *"Connection testing is not supported for adapter
dpd.polska.rest.v1"* because the plugin registers no `ConnectionTesterPort`.

- **Layer**: Integration → Infrastructure (adapter) + plugin registration.
- **Non-goals**: no FE change (the connection-detail action already calls the
  registry), no new core port, no validation that a full shipment payload would
  succeed — auth-only probe.

## 2. Research findings (live sandbox, verified via curl)

- DPDServices has no cheap `GET /me`. Every endpoint is `POST`.
- `findPoints` returns `403` for both valid + invalid creds on demo → useless as a probe.
- `POST /public/shipment/v1/generatePackagesNumbers` with empty body `{}`:
  - valid creds → **HTTP 400** validation error (`generationPolicy must not be null`) — auth passed, **no waybill created** (validation precedes creation).
  - invalid creds → **HTTP 401**.
  - valid creds but no `X-DPD-FID` header → **HTTP 401** (FID header required for auth).
- Precedent: `AllegroConnectionTesterAdapter` + `register(host)` in the plugin.

## 3. Design

`DpdConnectionTesterAdapter implements ConnectionTesterPort`. It issues one raw
`fetch` (no retry, short timeout) — **not** `DpdHttpClient`, because the client
throws `ShippingProviderRejectionException` on 400 (our success signal) and would
invert the semantics.

Probe result mapping:
| HTTP status | Result |
|---|---|
| 400 | `success: true`, `message: 'OK'` (auth accepted, body validation rejected) |
| 401 / 403 | `success: false`, message `401 Unauthorized` / `403 Forbidden` |
| other / network error | `success: false`, message echoes status or error |

The base URL is shared with the factory via a new `dpd-hosts.ts` so they can't drift.

## 4. Steps

1. **`infrastructure/http/dpd-hosts.ts`** (new) — move `BASE_URLS` out of the
   factory into `getDpdServicesBaseUrl(environment: DpdEnvironment): string`.
   Refactor `dpd-adapter.factory.ts` to import + use it. (Leave `INFO_BASE_URLS`
   in the factory — the tester doesn't touch SOAP tracking.)
2. **`infrastructure/adapters/dpd-connection-tester.adapter.ts`** (new) —
   `implements ConnectionTesterPort`:
   - read `environment` + `masterFid` from `connection.config`; resolve
     `{ login, password }` via `credentialsResolver`;
   - `POST {}` to `${getDpdServicesBaseUrl(environment)}/public/shipment/v1/generatePackagesNumbers`
     with `Authorization: Basic …` and, when `masterFid` present, `X-DPD-FID`;
   - `AbortController` timeout ~10 s;
   - map status per table above; never throw.
3. **`dpd-plugin.ts`** — in `register(host)` add
   `host.connectionTesterRegistry.register(dpdAdapterManifest.adapterKey, new DpdConnectionTesterAdapter())`.
4. **`__tests__/dpd-connection-tester.adapter.spec.ts`** (new) — mock global
   `fetch`: 400 → success; 401 → failure; assert `X-DPD-FID` sent iff `masterFid`
   set; network error → `success: false` (no throw).

## 5. Validation

- Architecture: adapter lives in the plugin's infrastructure layer, depends only
  on core contracts (`ConnectionTesterPort`, `ConnectionTestResult`,
  `CredentialsResolverPort`) via the `@openlinker/core/integrations` barrel. No
  CORE↔Integration violation.
- Naming: `*.adapter.ts`, `*.spec.ts`, file header comment present.
- Security: credentials never logged; message strings are UI-safe (status text
  only), no credential echo.
