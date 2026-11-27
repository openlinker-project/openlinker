# Implementation Plan: Mirakl plugin foundation with Empik as first operator (#4274)

**Epic:** #4273 · **Spike:** #4268 (`docs/plans/analysis/SPIKE-4268-empik-mirakl.md`, local)
**Branch:** `4274-mirakl-plugin-foundation`, stacked on `4273-empik-mirakl-integration`

---

## 1. Task

Create the Mirakl Seller API plugin package with Empik as its first operator profile. This issue delivers no capability. It provides what every later Empik issue (#4275-#4279) builds on:

1. **Connection.** Config and credentials validation, a connection tester, and retry and auth-failure classifiers.
2. **HTTP client.** It handles both Mirakl pagination styles and both error shapes.
3. **Import tracker.** It covers the four Mirakl async import flavours.
4. **Frontend.** A setup card, a connection wizard and a credentials panel.

**Layer:** Integration (`libs/integrations/mirakl`) and Frontend (`apps/web/src/plugins/empik`).

**Non-goals:**

- No `OrderSource` / `OfferManager` adapters (#4275, #4277).
- No scheduler tasks.
- No webhooks: Mirakl webhooks are operator-only, verified in the spike.
- No core changes.

---

## 2. Research

| Need | Precedent | File |
|---|---|---|
| Plugin descriptor + static manifest | Erli | `libs/integrations/erli/src/erli-plugin.ts` |
| Host module without plugin-specific deps | inFakt, DPD | `libs/integrations/infakt/src/infakt-integration.module.ts` (`createNestAdapterModule`) |
| Per-connection factory, credentials, base URL | Erli | `libs/integrations/erli/src/application/erli-adapter.factory.ts` |
| HTTP client (fetch via connection-bound transport, retry, bounded body, host-escape guard, typed exceptions) | Erli | `libs/integrations/erli/src/infrastructure/http/erli-http-client.ts` |
| Connection tester (no-retry probe, sanitised failures) | Erli | `.../erli-connection-tester.adapter.ts` |
| Hand-rolled config/credentials validators | Erli | `.../erli-connection-{config,credentials}-shape-validator.adapter.ts` |
| Retry / auth-failure classifiers | Erli | `.../erli-{retry,auth-failure}-classifier.adapter.ts` |
| Web plugin (setup card, route, credentials panel, i18n) | DPD, Erli | `apps/web/src/plugins/{dpd,erli}/`, `apps/web/src/pages/connections/erli-setup-page.tsx`, `apps/web/src/features/connections/components/erli-setup-{form,summary}.tsx`, `erli-setup.schema.ts` |

**Every place a new integration package is wired** (grep for `integrations-erli`):

- `tsconfig.base.json`: `paths`.
- `apps/api/tsconfig.json`, `apps/worker/tsconfig.json`: `paths`.
- `apps/api/package.json`, `apps/worker/package.json`: `dependencies`.
- `apps/api/src/plugins.ts`, `apps/worker/src/plugins.ts`: plugin module arrays.
- `Dockerfile`: two `COPY package.json` lines and one `COPY dist` line.
- `.eslintrc.js`: the `no-restricted-globals` fetch ban `files` list.
- `scripts/check-outbound-http.mjs`: `SCAN_ROOTS`.
- `pnpm-lock.yaml`: updated by `pnpm install`.
- `apps/web/src/plugins/index.ts`.

**Live facts from the spike (staging, shop 6881):**

- **Auth.** `Authorization: <key>` with no `Bearer`. A wrong key or production host returns `401 {"status":401,"message":"Unauthorized"}`.
- **Base URLs.** Production `https://marketplace.empik.com`, staging `https://stg1.marketplace.empik.com`. Paths start with `/api/...`.
- **Probe.** `GET /api/account` (A01) returns `shop_id`, `shop_name`, `shop_state`, `currency_iso_code`.
- **Pagination.** OR11 / OF21 / P31 use offset (`max`, `offset`, `total_count`). OF02 / RT11 / PRI02 use seek (`next_page_token`, `previous_page_token`, `data`).
- **Error shapes.** `{ code, message, status }` (OR21, e.g. `ORDER_NOT_FOUND`). `{ message, status }` (OR23, 400 validation). Plain `{ message: "Method Not Allowed", status: 405 }`.
- **Import flavours:**

  | Import | Submit | Id | Status | Error report |
  |---|---|---|---|---|
  | Offers | OF24 `POST /api/offers` (JSON) or OF01 (file) | numeric | OF02 `GET /api/offers/imports/{id}` | OF03 `/api/offers/imports/{id}/error_report`, quoted `;` CSV, last two columns `error-line;error-message` |
  | Stock | STO01 `POST /api/offers/stock/imports` (multipart CSV) | UUID | STO02 `/api/offers/stock/imports/{id}/status` | STO03 `/api/offers/stock/imports/{id}/error_report`, plain `;` CSV `line-number;errors;…` |
  | Price | PRI01 `POST /api/offers/pricing/imports` (multipart CSV) | UUID | PRI02 `GET /api/offers/pricing/imports?import_id=` (seek list) | PRI03 `/api/offers/pricing/imports/{id}/error_report` |
  | Products | P41 `POST /api/products/imports` (multipart CSV) | numeric | P42 `/api/products/imports/{id}` (`import_status`: `SENT`, …) | P44 `/api/products/imports/{id}/error_report` |

  Every flavour can end `COMPLETE` with error lines.

- **Shipping charges.** SH52 `GET /api/shipping/charges/shop` returns `configuration: []` when no zone is set, and then every offer is inactive (`NO_MIN_SHIPPING_RATE`).
- **Rate limiting.** 429 with `Retry-After` in seconds. No Empik limits are published.

---

## 3. Design

### 3.1 Package `libs/integrations/mirakl` (`@openlinker/integrations-mirakl`)

```
src/
  index.ts                                   # barrel: manifest(s), createMiraklPlugin, EmpikIntegrationModule, exceptions, profile type
  mirakl.constants.ts                        # EMPIK_ADAPTER_KEY = 'empik.mirakl.v1'
  mirakl-plugin.ts                           # createMiraklPlugin(profile) → AdapterPlugin; manifest built from the profile
  operators/empik.profile.ts                 # empikOperatorProfile (data only)
  empik-integration.module.ts                # EmpikIntegrationModule = createNestAdapterModule({ plugin: createMiraklPlugin(empikOperatorProfile) })
  application/
    mirakl-adapter.factory.ts                # resolve credentials + base URL → MiraklHttpClient
    interfaces/mirakl-adapter.factory.interface.ts
  domain/
    types/mirakl-operator-profile.types.ts   # MiraklOperatorProfile
    types/mirakl-connection.types.ts         # credentials { apiKey }, config { environment, shopId? }, MiraklEnvironmentValues
    types/mirakl-import.types.ts             # MiraklImportKind, MiraklImportStatus, MiraklImportLineError
    policies/mirakl-base-url.policy.ts       # resolveMiraklBaseUrl(profile, config): https + operator host only
    exceptions/mirakl-{api,authentication,rate-limit,network,config}.exception.ts
  infrastructure/
    http/mirakl-http-client.ts               # MiraklHttpClient
    http/mirakl-http-client.interface.ts     # IMiraklHttpClient (package-private)
    http/mirakl-http-client.types.ts         # options, response, retry config, page shapes
    http/mirakl-pagination.ts                # listAllOffset / listAllSeek (bounded)
    imports/mirakl-import-tracker.ts         # MiraklImportTracker
    imports/mirakl-import-tracker.interface.ts
    imports/mirakl-error-report.parser.ts    # ';' CSV with quotes → row records
    adapters/mirakl-connection-tester.adapter.ts
    adapters/mirakl-connection-{config,credentials}-shape-validator.adapter.ts
    adapters/mirakl-{retry,auth-failure}-classifier.adapter.ts
```

**Operator profile (data only, § ADR):**

```ts
interface MiraklOperatorProfile {
  adapterKey: string;            // 'empik.mirakl.v1'
  platformType: string;          // 'empik'
  displayName: string;           // 'Empik Marketplace'
  brand: string;                 // 'Empik' (error messages)
  baseUrls: { production: string; staging: string };
  allowedHosts: readonly string[];  // ['marketplace.empik.com', 'stg1.marketplace.empik.com']
}
```

- Order and offer rules (`maxTrackingNumbers`, `nip` field code, `stateCode`, `variantGroupAttribute`) are **not** added here. They arrive with the issues that read them (#4275-#4278), so nothing in the profile is unused.
- The manifest is built from the profile with `supportedCapabilities: []`, `isDefault: true` and no `defaultRateLimit` (#1810: platform-hosted).
- **The base URL comes only from the profile's `baseUrls` via `config.environment`.** There is no free `baseUrl` override, so the SSRF surface is zero. `allowedHosts` is re-checked in the client as defence in depth.

**`MiraklHttpClient`** follows `ErliHttpClient`, with these differences:

- `Authorization: <apiKey>` (no `Bearer`).
- `shopId` from config is appended as the `shop_id` query param on every request when set.
- Methods: `get`, `post` (JSON), `put` (JSON), and `postFile(path, { fieldName, fileName, contentType, content })` for multipart imports. `postFile` is non-idempotent: it fails fast on 5xx/network, because a re-sent import could double-apply.
- **Error mapping:**
  - 401 / 403 → `MiraklAuthenticationException`.
  - 429 → retry with `Retry-After`; once exhausted, `MiraklRateLimitException`.
  - 5xx / network → retry only if idempotent; otherwise `MiraklNetworkException`.
  - Any other 4xx → `MiraklApiException { statusCode, miraklCode?, miraklMessage? }`. The body is parsed for both shapes (`code` optional). The raw body is kept for debugging only.
- **Response cap: 8 MiB.** VL11 returns 183 MB without a filter, so oversize is an explicit `MiraklNetworkException`. Later issues must filter by `code`.
- **CSV / text bodies:** `getText(path)` returns the raw body for error reports, which come back as CSV, not JSON.

**Pagination helpers** (`mirakl-pagination.ts`):

- **`listAllOffset(client, path, { itemsKey, max = 100, maxPages })`.** Reads `{ [itemsKey]: T[], total_count }` and stops at `total_count` or on an empty page.
- **`listAllSeek(client, path, { maxPages })`.** Reads `{ data: T[], next_page_token }` and stops when the token is null.
- **Both are bounded by `maxPages`.** Hitting the cap does not throw: the helper returns `{ items, truncated: true }`, so a caller cannot mistake a partial read for a full one.

**`MiraklImportTracker`:**

- **`getStatus(kind, importId)`** → `MiraklImportStatus`:

  ```ts
  { kind, importId, state: 'pending' | 'awaiting-operator' | 'done' | 'failed',
    linesRead?, linesInSuccess?, linesInError?, hasErrorReport, raw }
  ```

  The normalisation is per kind:

  | Kind | `done` | `failed` | Pending (`state: 'pending'`) |
  |---|---|---|---|
  | `offers` | `COMPLETE` | `FAILED` / `CANCELLED` | `WAITING`, `RUNNING`, `QUEUED` |
  | `stock` | `COMPLETE` | `FAILED` / `CANCELLED` | as for `offers` |
  | `prices` | `COMPLETE` (first row of the PRI02 seek list filtered by id) | `FAILED` / `CANCELLED` | as for `offers` |
  | `products` | `COMPLETE` | `FAILED` / `CANCELLED` / `REJECTED` | `TRANSFORMATION_WAITING`, `RUNNING` |

  For `products`, `SENT` / `WAITING_SYNCHRONIZATION_PRODUCT` map to `awaiting-operator`. That is the state where Empik has the card and has not synced it, which the spike found can last indefinitely.

  An unknown status maps to `pending` with a warn log. It never maps to `done`, because a partial status must not be read as success.
- **`getErrorReport(kind, importId)`** → `MiraklImportLineError[]` (`{ line?, sku?, reason }`), parsed by `mirakl-error-report.parser.ts`. The parser accepts `;` CSV with optional double quotes, and finds the reason column by header name: `error-message` (OF03), `errors` (STO03), and any column named `error*`.
- The tracker never sleeps and never loops. The "at most once a minute" pacing belongs to the job that calls it (#4277), stated in the docblock.

**Connection tester:**

- A01 `GET /api/account` with the no-retry budget. A 2xx means the connection is reachable and the key accepted. Failures are sanitised exactly as in Erli.
- **The shipping-zone check (SH52) is deferred to #4277.** `ConnectionTestOutcome` has no warning value and the frontend copy is chosen by outcome (`describe-connection-test-failure.ts`), so a successful test cannot carry a warning without a core + web change. #4277 surfaces it where it matters: per offer, as `inactivity_reasons: NO_MIN_SHIPPING_RATE`. See § 6.

**Classifiers:**

- Retry: `MiraklApiException`, `MiraklAuthenticationException` and `MiraklConfigException` are non-retryable.
- Auth failure: `MiraklAuthenticationException`.

**Validators:**

- Credentials: a non-empty `apiKey` string.
- Config:
  - `environment` ∈ `MiraklEnvironmentValues` (`'production' | 'staging'`) when present;
  - `shopId`, when present, is a positive integer (number or digit string);
  - `masterCatalogConnectionId` is a UUID when present, mirroring Erli;
  - unknown keys are allowed, as in Erli, because the host writes generic keys (`rateLimit`, `stockSafetyBuffer`, `pricingRule`).

### 3.2 Frontend `apps/web/src/plugins/empik`

Mirrors DPD plus the Erli setup form:

- `apps/web/src/plugins/empik/{index.ts, messages.ts, empik-setup.route.tsx, locales/{en,pl,limits}.json, components/empik-credentials-panel.tsx}`.
- `apps/web/src/pages/connections/empik-setup-page.tsx`.
- `apps/web/src/features/connections/components/empik-setup-{form,summary}.tsx` and `empik-setup.schema.ts`. Fields:
  - name;
  - environment (Staging / Production; default Production);
  - API key;
  - optional shop id.

  The form submits `{ platformType: 'empik', adapterKey: 'empik.mirakl.v1', config: { environment, shopId? }, credentials: { apiKey } }`, then runs the connection test, as the Erli form does.
- `apps/web/src/plugins/index.ts`: add `empikPlugin` after `erliPlugin`.
- **Copy:**
  - In both `en` and `pl`, sorted (`pnpm i18n:sort`).
  - Polish written per `docs/i18n-glossary.md`.
  - Button and badge budgets in `limits.json`.
  - The setup copy tells the operator where the key is: panel → user menu → "Klucz API".
  - It also says that offers need a shipping zone, a one-line note so the shipping-zone requirement is visible before #4277 surfaces it per offer.
- **No structured config section.** The edit form falls back to raw JSON, the DPD precedent.

### 3.3 Wiring (mirrors Erli)

- `tsconfig.base.json` paths (`@openlinker/integrations-mirakl`, `/*`); same in `apps/api/tsconfig.json` and `apps/worker/tsconfig.json`.
- `apps/{api,worker}/package.json`: `"@openlinker/integrations-mirakl": "workspace:*"`. Then `pnpm install` updates `pnpm-lock.yaml`.
- `apps/{api,worker}/src/plugins.ts`: `EmpikIntegrationModule`.
- `Dockerfile`: the three COPY lines.
- `.eslintrc.js` fetch-ban `files`, `scripts/check-outbound-http.mjs` `SCAN_ROOTS`: add `libs/integrations/mirakl`.

### 3.4 ADR

`docs/architecture/adrs/0NN-mirakl-plugin-with-operator-profiles.md` (next free number) records:

- **Why one Mirakl package.** Every Mirakl operator exposes the same Seller API.
- **Why the profile is data-only and grows with the second operator.**
- **Why each operator is its own adapter / platformType / connection type.** This is what Base.com does, and it keeps operator-specific capabilities and copy separate.
- **Why there is no `baseUrl` override.** Zero SSRF surface.
- **Why there are no webhooks.** They are operator-only, so the integration polls.
- **Why stock and price never go through OF24.** It overwrites the whole offer; this is the rule #4277 depends on.

---

## 4. Steps

| # | Step | Files | Done when |
|---|---|---|---|
| 1 | Package scaffold (package.json, tsconfig, jest config, README) | `libs/integrations/mirakl/*` | Builds with `tsc -b` |
| 2 | Profile, connection, import types; constants; base-URL policy | `src/domain/**`, `mirakl.constants.ts`, `operators/empik.profile.ts` | Types only; policy refuses http, off-allowlist hosts |
| 3 | Exceptions | `src/domain/exceptions/*` | Five classes, Erli docblock posture |
| 4 | HTTP client + types + interface | `src/infrastructure/http/*` | Spec: auth header, `shop_id`, both error shapes, 429 Retry-After, idempotency rules, size cap, `postFile` multipart, host-escape guard |
| 5 | Pagination helpers | `src/infrastructure/http/mirakl-pagination.ts` | Spec: offset stop on total/empty, seek stop on null token, `truncated` at `maxPages` |
| 6 | Error-report parser + import tracker | `src/infrastructure/imports/*` | Spec: the four flavours from real staging bodies (fixtures copied from the spike), `COMPLETE` with errors → `done` + `linesInError > 0`, `SENT` → `awaiting-operator`, unknown → `pending` |
| 7 | Factory | `src/application/*` | Spec: credentials resolution, environment → base URL, `shopId` threaded |
| 8 | Tester, validators, classifiers | `src/infrastructure/adapters/*` | Specs mirroring Erli's |
| 9 | Plugin + module + barrel | `mirakl-plugin.ts`, `empik-integration.module.ts`, `index.ts` | Spec: manifest from profile, empty capabilities, every registration called, `createCapabilityAdapter` rejects every capability |
| 10 | Wiring | § 3.3 files | `pnpm type-check`, `pnpm lint`, `pnpm check:invariants` pass |
| 11 | ADR | `docs/architecture/adrs/` | Written; listed in the ADR index |
| 12 | Web plugin + setup flow + i18n | § 3.2 files | Component tests for form + schema + credentials panel; `check-locales` passes |
| 13 | Live smoke (throwaway, outside repo) | scratchpad script | Factory + tester + tracker run against `stg1` with the staging key: A01 OK, tracker reads import 2156101 (`done`) and 2156124 (`done`, 1 error line), P41 30532 (`awaiting-operator`) |
| 14 | Docs touch | `docs/architecture-overview.md` (short Mirakl note under Integrations), `README.md` integrations list | Present |

---

## 5. Validation

- **Hexagonal.**
  - Domain holds types, policies and exceptions only, with no framework imports.
  - The factory lives in `application` and depends on interfaces.
  - The HTTP client and adapters live in `infrastructure`.
  - Nothing in core changes.
- **Imports.** Only top-level `@openlinker/core/<ctx>` barrels; same-package relative imports.
- **Outbound HTTP.** Only through `host.http.forConnection(connection)` (`FetchLike` required, as in Erli). The package is added to both the eslint fetch ban and `check-outbound-http`.
- **Security:**
  - The API key is never logged.
  - There is no `baseUrl` override.
  - The host allowlist is re-checked on every request.
  - Tester messages are sanitised.
  - The error-response body is never logged above debug.
- **Tests.**
  - Unit specs for every non-trivial file (steps 4-9, 12).
  - Not executed locally (session rule); `type-check` + `lint` + `check:invariants` are run.
  - The live smoke (step 13) stands in for an int-spec until #4275 brings the vertical slice.

---

## 6. Decisions / deviations from the issue text

1. **`TaxonomyIdentityProvider` moves to #4278.** It is an `OfferManagerPort` sub-capability, and this issue ships no `OfferManager` adapter to declare it on.
2. **The shipping-zone warning in the connection test is not done here** (see § 3.1, tester). Doing it needs a new `ConnectionTestOutcome` and web copy, which is a core change the epic did not plan. The rule surfaces per offer in #4277, and the setup screen states it up front.
3. **No `baseUrl` config override**, unlike Erli. URLs come from the profile only.
4. **The base URL environment is named `staging`, not `sandbox`.** That is what Empik calls it (`stg1`).
